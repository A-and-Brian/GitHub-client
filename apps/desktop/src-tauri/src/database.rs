use std::{error::Error, fs, path::Path};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_sql::{DbInstances, DbPool};

const DATABASE_KEY: &str = "sqlite:github-client-normalized-v1.sqlite";
const DATABASE_FILENAME: &str = "github-client-normalized-v1.sqlite";

pub(crate) async fn initialize_sqlite(
    config_dir: &Path,
    instances: &DbInstances,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    // TanStack sends BEGIN, statements, and COMMIT through separate IPC calls. Keep
    // them on one native connection and prevent pool recycling between those calls.
    // All SQL must continue through the shared TanStack adapter queue.
    let mut pools = instances.0.write().await;
    if pools.contains_key(DATABASE_KEY) {
        return Ok(());
    }

    fs::create_dir_all(config_dir)?;
    let options = SqliteConnectOptions::new()
        .filename(config_dir.join(DATABASE_FILENAME))
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .idle_timeout(None)
        .max_lifetime(None)
        .connect_with(options)
        .await?;

    pools.insert(DATABASE_KEY.to_string(), DbPool::Sqlite(pool));
    Ok(())
}

#[tauri::command]
pub(crate) async fn initialize_database<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    initialize_sqlite(&config_dir, &app.state::<DbInstances>())
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };

    use sqlx::{pool::Pool, Row, Sqlite};
    use tauri_plugin_sql::{DbInstances, DbPool};

    use super::{initialize_sqlite, DATABASE_FILENAME, DATABASE_KEY};

    static NEXT_TEST_DIR: AtomicUsize = AtomicUsize::new(0);

    fn test_config_dir() -> PathBuf {
        let suffix = NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "github-client-sqlite-test-{}-{suffix}",
            std::process::id()
        ))
    }

    fn make_instances() -> DbInstances {
        DbInstances::default()
    }

    async fn get_pool(instances: &DbInstances) -> Pool<Sqlite> {
        let pools = instances.0.read().await;
        match pools.get(DATABASE_KEY).expect("initialized pool") {
            DbPool::Sqlite(pool) => pool.clone(),
        }
    }

    async fn execute(pool: &Pool<Sqlite>, statement: &str) -> Result<(), sqlx::Error> {
        let mut connection = pool.acquire().await?;
        sqlx::query(statement).execute(&mut *connection).await?;
        Ok(())
    }

    async fn transaction(pool: &Pool<Sqlite>, value: &str) -> Result<(), sqlx::Error> {
        execute(pool, "BEGIN IMMEDIATE").await?;
        let mut connection = pool.acquire().await?;
        sqlx::query("INSERT INTO records (value) VALUES (?)")
            .bind(value)
            .execute(&mut *connection)
            .await?;
        drop(connection);
        execute(pool, "COMMIT").await
    }

    #[test]
    fn separate_acquisitions_keep_begin_write_read_and_commit_on_one_connection() {
        tauri::async_runtime::block_on(async {
            let config_dir = test_config_dir();
            let instances = make_instances();
            initialize_sqlite(&config_dir, &instances).await.unwrap();
            let pool = get_pool(&instances).await;
            execute(&pool, "CREATE TABLE records (value TEXT NOT NULL)")
                .await
                .unwrap();

            execute(&pool, "BEGIN IMMEDIATE").await.unwrap();
            let mut connection = pool.acquire().await.unwrap();
            sqlx::query("INSERT INTO records (value) VALUES (?)")
                .bind("committed")
                .execute(&mut *connection)
                .await
                .unwrap();
            drop(connection);
            let mut connection = pool.acquire().await.unwrap();
            let row = sqlx::query("SELECT value FROM records")
                .fetch_one(&mut *connection)
                .await
                .unwrap();
            assert_eq!(row.get::<String, _>(0), "committed");
            drop(connection);
            execute(&pool, "COMMIT").await.unwrap();

            pool.close().await;
            fs::remove_dir_all(config_dir).unwrap();
        });
    }

    #[test]
    fn rollback_releases_the_connection_and_persisted_data_survives_reopen() {
        tauri::async_runtime::block_on(async {
            let config_dir = test_config_dir();
            let instances = make_instances();
            initialize_sqlite(&config_dir, &instances).await.unwrap();
            let pool = get_pool(&instances).await;
            execute(&pool, "CREATE TABLE records (value TEXT NOT NULL)")
                .await
                .unwrap();

            execute(&pool, "BEGIN IMMEDIATE").await.unwrap();
            let mut connection = pool.acquire().await.unwrap();
            sqlx::query("INSERT INTO records (value) VALUES (?)")
                .bind("rolled-back")
                .execute(&mut *connection)
                .await
                .unwrap();
            drop(connection);
            assert!(
                execute(&pool, "INSERT INTO missing_table VALUES ('failure')")
                    .await
                    .is_err()
            );
            execute(&pool, "ROLLBACK").await.unwrap();
            let mut connection = pool.acquire().await.unwrap();
            let count = sqlx::query("SELECT COUNT(*) FROM records")
                .fetch_one(&mut *connection)
                .await
                .unwrap();
            assert_eq!(count.get::<i64, _>(0), 0);
            drop(connection);

            transaction(&pool, "kept").await.unwrap();
            pool.close().await;
            let reopened = make_instances();
            initialize_sqlite(&config_dir, &reopened).await.unwrap();
            let reopened_pool = get_pool(&reopened).await;
            let mut connection = reopened_pool.acquire().await.unwrap();
            let row = sqlx::query("SELECT value FROM records")
                .fetch_one(&mut *connection)
                .await
                .unwrap();
            assert_eq!(row.get::<String, _>(0), "kept");
            drop(connection);
            reopened_pool.close().await;

            assert!(config_dir.join(DATABASE_FILENAME).exists());
            fs::remove_dir_all(config_dir).unwrap();
        });
    }

    #[test]
    fn normalized_database_starts_empty_and_preserves_the_previous_store() {
        tauri::async_runtime::block_on(async {
            let config_dir = test_config_dir();
            fs::create_dir_all(&config_dir).unwrap();
            let old_file = config_dir.join("github-client.sqlite");
            let old_options = sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&old_file)
                .create_if_missing(true);
            let old_pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(old_options)
                .await
                .unwrap();
            execute(&old_pool, "CREATE TABLE previous_data (value TEXT)")
                .await
                .unwrap();
            execute(&old_pool, "INSERT INTO previous_data VALUES ('retained')")
                .await
                .unwrap();
            old_pool.close().await;
            let previous_bytes = fs::read(&old_file).unwrap();

            let instances = make_instances();
            initialize_sqlite(&config_dir, &instances).await.unwrap();
            let pool = get_pool(&instances).await;
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'previous_data'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(count, 0);
            assert_eq!(fs::read(&old_file).unwrap(), previous_bytes);
            pool.close().await;
            fs::remove_dir_all(config_dir).unwrap();
        });
    }

    #[test]
    fn initialization_is_idempotent() {
        tauri::async_runtime::block_on(async {
            let config_dir = test_config_dir();
            let instances = make_instances();
            initialize_sqlite(&config_dir, &instances).await.unwrap();
            execute(
                &get_pool(&instances).await,
                "CREATE TEMP TABLE still_here (value TEXT)",
            )
            .await
            .unwrap();

            initialize_sqlite(&config_dir, &instances).await.unwrap();
            let current_pool = get_pool(&instances).await;
            let mut connection = current_pool.acquire().await.unwrap();
            sqlx::query("INSERT INTO still_here (value) VALUES ('same connection')")
                .execute(&mut *connection)
                .await
                .unwrap();
            let row = sqlx::query("SELECT value FROM still_here")
                .fetch_one(&mut *connection)
                .await
                .unwrap();
            assert_eq!(row.get::<String, _>(0), "same connection");
            drop(connection);

            current_pool.close().await;
            fs::remove_dir_all(config_dir).unwrap();
        });
    }
}

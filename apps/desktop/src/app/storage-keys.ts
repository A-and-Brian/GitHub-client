/** Last signed-in viewer, used to start offline from cached data. */
export const VIEWER_KEY = "github-client.viewer"
/** Set on sign-out so that `GITHUB_TOKEN` does not sign the user straight back in. */
export const SIGNED_OUT_KEY = "github-client.signed-out"
/** Update version whose prompt was dismissed, so background checks do not ask again. */
export const UPDATE_DISMISSED_KEY = "github-client.update-dismissed"

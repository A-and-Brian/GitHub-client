import { GitHubError, type RestClient } from "./rest"

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string; type?: string }>
}

export class GraphQLClient {
  constructor(private readonly rest: RestClient) {}

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await this.rest.request<GraphQLResponse<T>>("POST", "/graphql", {
      query,
      variables,
    })
    if (response.errors?.length) {
      throw new GitHubError(200, response.errors.map((e) => e.message).join("; "), response.errors)
    }
    return response.data as T
  }
}

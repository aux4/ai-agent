import { ResponsesApi } from "./ResponsesApi.js";
import { getChatGPTAccessToken } from "./ChatGPTAuth.js";

export class ChatGPTApi extends ResponsesApi {
  constructor(config = {}) {
    super({ ...config, accessTokenProvider: getChatGPTAccessToken });
  }
}

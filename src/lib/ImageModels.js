import OpenAI from "openai";

/**
 * Helper function to convert image URL to base64
 * @param {string} url - The image URL
 * @returns {Promise<string>} - Base64 encoded image data
 */
async function urlToBase64(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer.toString("base64");
  } catch (error) {
    throw new Error(`Failed to convert URL to base64: ${error.message}`);
  }
}

/**
 * Generic image generator class that wraps different image generation models
 */
class ImageGenerator {
  constructor(config = {}) {
    this.config = config;
    this.type = config.type || "openai";
    this.model = this.createModel();
  }

  createModel() {
    switch (this.type) {
      case "openai":
        return new OpenAI({
          apiKey: this.config.config?.apiKey || process.env.OPENAI_API_KEY,
          ...this.config.config
        });
      case "xai":
        return new OpenAI({
          apiKey: this.config.config?.apiKey || process.env.XAI_API_KEY,
          baseURL: this.config.config?.baseURL || "https://api.x.ai/v1",
          ...this.config.config
        });
      default:
        throw new Error(`Unsupported image generation model type: ${this.type}`);
    }
  }

  /**
   * Generate an image from a text prompt
   * @param {string} prompt - The text prompt to generate image from
   * @param {Object} options - Additional options like size, quality, etc.
   * @returns {Promise<string>} - Base64 encoded image data
   */
  async generateImage(prompt, options = {}) {
    try {
      switch (this.type) {
        case "openai":
          return await this.generateOpenAIImage(prompt, options);
        case "xai":
          return await this.generateOpenAIImage(prompt, options);
        default:
          throw new Error(`Image generation not implemented for type: ${this.type}`);
      }
    } catch (error) {
      throw new Error(`Image generation failed: ${error.message}`);
    }
  }

  async generateOpenAIImage(prompt, options = {}) {
    // dall-e-3/dall-e-2 have been retired on the OpenAI Images API; gpt-image-1
    // is the current default model for new API keys/projects.
    const defaultModel = this.type === "xai" ? "grok-2-image-latest" : "gpt-image-1";
    const model = this.config.config?.model || defaultModel;

    // Handle quality parameter for different model types
    let qualityValue = options.quality;
    if (!qualityValue) {
      // Set appropriate default if no quality specified
      if (model.startsWith("gpt-image")) {
        qualityValue = "auto";
      } else if (model.startsWith("grok-")) {
        qualityValue = "standard";
      } else {
        qualityValue = "standard";
      }
    } else {
      // Map quality values between model types if needed
      if (model.startsWith("gpt-image") && qualityValue === "standard") {
        qualityValue = "auto"; // Map DALL-E "standard" to gpt-image "auto"
      } else if (model.startsWith("dall-e") && ["low", "medium", "high", "auto"].includes(qualityValue)) {
        qualityValue = "standard"; // Map gpt-image qualities to DALL-E "standard"
      }
    }

    let nValue = options.quantity || 1;

    // gpt-image and grok models don't support n > 1, force to 1 and handle multiple generation at higher level
    if ((model.startsWith("gpt-image") || model.startsWith("grok-")) && nValue > 1) {
      nValue = 1;
    }

    const params = {
      prompt: prompt,
      model: model
    };

    // Only add parameters for models that support them (not grok models)
    if (!model.startsWith("grok-")) {
      params.size = options.size || "1024x1024";
      params.quality = qualityValue;
      params.n = nValue;
    }

    // Only add response_format for DALL-E models, not gpt-image-1 or grok models
    if (model.startsWith("dall-e")) {
      params.response_format = "b64_json";
    }

    // Use OpenAI client directly for image generation
    const openai = this.model;

    try {
      const response = await openai.images.generate(params);

      if (response.data && response.data.length > 0) {
        // If only one image requested, return single result
        if (response.data.length === 1) {
          // Handle base64 response (DALL-E models)
          if (response.data[0].b64_json) {
            return response.data[0].b64_json;
          }
          // Handle URL response (gpt-image-1 and other models)
          if (response.data[0].url) {
            // For xAI/Grok models, convert URL to base64 for consistency
            if (model.startsWith("grok-")) {
              return await urlToBase64(response.data[0].url);
            }
            return response.data[0].url;
          }
        } else {
          // Multiple images - return array
          return Promise.all(response.data.map(async imageData => {
            if (imageData.b64_json) {
              return imageData.b64_json;
            }
            if (imageData.url) {
              // For xAI/Grok models, convert URL to base64 for consistency
              if (model.startsWith("grok-")) {
                return await urlToBase64(imageData.url);
              }
              return imageData.url;
            }
            return null;
          })).then(results => results.filter(Boolean));
        }
      }

      throw new Error("No image data returned from OpenAI");
    } catch (error) {
      throw new Error(`OpenAI image generation failed: ${error.message}`);
    }
  }

  /**
   * Get supported models for the current type
   * @returns {Array<string>} - Array of supported model names
   */
  getSupportedModels() {
    switch (this.type) {
      case "openai":
        return ["gpt-image-1", "gpt-image-1-mini", "dall-e-3", "dall-e-2"];
      case "xai":
        return ["grok-2-image-latest"];
      default:
        return [];
    }
  }

  /**
   * Get supported sizes for the current type and model
   * @returns {Array<string>} - Array of supported sizes
   */
  getSupportedSizes() {
    switch (this.type) {
      case "openai": {
        const model = this.config.config?.model || "gpt-image-1";
        if (model === "dall-e-3") {
          return ["1024x1024", "1024x1792", "1792x1024"];
        } else if (model === "dall-e-2") {
          return ["256x256", "512x512", "1024x1024"];
        } else if (model.startsWith("gpt-image")) {
          return ["1024x1024", "1024x1536", "1536x1024"];
        }
        return ["1024x1024"];
      }
      case "xai":
        return []; // xAI/Grok doesn't support size parameter
      default:
        return ["1024x1024"];
    }
  }
}

/**
 * Get image generator instance
 * @param {string} type - The image generation model type (e.g., "openai")
 * @param {Object} config - Model configuration
 * @returns {ImageGenerator} - Image generator instance
 */
export function getImageGenerator(type = "openai", config = {}) {
  return new ImageGenerator({ type, ...config });
}

export default ImageGenerator;
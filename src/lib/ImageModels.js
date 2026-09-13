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
 * Map a WxH size string to the closest Imagen aspect ratio.
 * @param {string} size - Size string like "1024x1024"
 * @returns {string|null} - Aspect ratio (e.g. "1:1") or null if unknown
 */
function sizeToAspectRatio(size) {
  const map = {
    "1024x1024": "1:1",
    "1792x1024": "16:9",
    "1024x1792": "9:16",
    "1408x768": "16:9",
    "768x1408": "9:16",
    "1248x832": "3:2",
    "832x1248": "2:3"
  };
  if (map[size]) return map[size];
  const match = /^(\d+)x(\d+)$/.exec(size || "");
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!w || !h) return null;
  if (w === h) return "1:1";
  return w > h ? "16:9" : "9:16";
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
      case "gemini":
        // Gemini image generation uses direct REST calls (see generateGeminiImage);
        // no persistent client is required.
        return null;
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
        case "gemini":
          return await this.generateGeminiImage(prompt, options);
        default:
          throw new Error(`Image generation not implemented for type: ${this.type}`);
      }
    } catch (error) {
      throw new Error(`Image generation failed: ${error.message}`);
    }
  }

  async generateOpenAIImage(prompt, options = {}) {
    // gpt-image is the current OpenAI image model. dall-e-3 was the default until OpenAI began
    // rejecting `response_format` on it ("400 Unknown parameter"), which broke generation outright.
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
   * Generate an image using the Gemini API with an API key.
   * Routes Imagen models to the :predict endpoint and Gemini "Nano Banana"
   * image models to the :generateContent endpoint.
   * @param {string} prompt - The text prompt
   * @param {Object} options - Generation options (size, quantity, etc.)
   * @returns {Promise<string|string[]>} - Base64 image data (array if quantity > 1)
   */
  async generateGeminiImage(prompt, options = {}) {
    const model = this.config.config?.model || "gemini-2.5-flash-image";
    const apiKey =
      this.config.config?.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Gemini API key not found. Set GEMINI_API_KEY (or GOOGLE_API_KEY), or pass config.apiKey."
      );
    }
    const baseUrl = this.config.config?.baseURL || "https://generativelanguage.googleapis.com/v1beta";
    const n = options.quantity || 1;

    const context = { model, apiKey, baseUrl, n };
    if (model.startsWith("imagen")) {
      return await this.generateImagenImage(prompt, options, context);
    }
    return await this.generateGeminiContentImage(prompt, options, context);
  }

  async generateGeminiContentImage(prompt, options, { model, apiKey, baseUrl, n }) {
    const url = `${baseUrl}/models/${model}:generateContent`;
    const responseModalities = this.config.config?.responseModalities || ["TEXT", "IMAGE"];

    const requestOne = async () => {
      const body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities }
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gemini image API error (${response.status}): ${text}`);
      }

      const data = await response.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find(part => part.inlineData && part.inlineData.data);
      if (!imagePart) {
        const textPart = parts.find(part => part.text);
        const detail = textPart ? `: ${textPart.text.slice(0, 200)}` : "";
        throw new Error(`No image returned from Gemini model "${model}"${detail}`);
      }
      return imagePart.inlineData.data;
    };

    if (n <= 1) {
      return await requestOne();
    }

    const results = [];
    for (let i = 0; i < n; i++) {
      results.push(await requestOne());
    }
    return results;
  }

  async generateImagenImage(prompt, options, { model, apiKey, baseUrl, n }) {
    const url = `${baseUrl}/models/${model}:predict`;
    const parameters = { sampleCount: n };

    const aspectRatio = this.config.config?.aspectRatio || sizeToAspectRatio(options.size);
    if (aspectRatio) {
      parameters.aspectRatio = aspectRatio;
    }

    const body = { instances: [{ prompt }], parameters };

    const response = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Imagen API error (${response.status}): ${text}`);
    }

    const data = await response.json();
    const predictions = data.predictions || [];
    const images = predictions.map(prediction => prediction.bytesBase64Encoded).filter(Boolean);
    if (images.length === 0) {
      throw new Error(`No image data returned from Imagen model "${model}"`);
    }
    return images.length === 1 ? images[0] : images;
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
      case "gemini":
        return ["gemini-2.5-flash-image", "imagen-4.0-generate-001", "imagen-3.0-generate-002"];
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
      case "openai":
        const model = this.config.config?.model || "gpt-image-1";
        if (model === "dall-e-3") {
          return ["1024x1024", "1024x1792", "1792x1024"];
        } else if (model === "dall-e-2") {
          return ["256x256", "512x512", "1024x1024"];
        }
        return ["1024x1024"];
      case "xai":
        return []; // xAI/Grok doesn't support size parameter
      case "gemini":
        // Gemini "Nano Banana" image models size by prompt/aspect; Imagen maps
        // sizes to aspect ratios (see sizeToAspectRatio).
        return ["1024x1024", "1792x1024", "1024x1792"];
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
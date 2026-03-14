import { readFileSync } from "fs";
import "colors";

export const historyExecutor = async options => {
  const { historyFile } = options;

  if (!historyFile) {
    console.error("Error: No history file specified".red);
    process.exit(1);
  }

  try {
    const historyContent = readFileSync(historyFile, "utf8");
    const history = JSON.parse(historyContent);

    if (!Array.isArray(history)) {
      console.error("Error: Invalid history file format - expected an array".red);
      process.exit(1);
    }

    console.log(`📜 History from file: ${historyFile}`.bold);

    history.forEach((message, index) => {
      const timestamp = message.timestamp ? ` ${new Date(message.timestamp).toLocaleString()}` : "";
      console.log(`\n[${"#" + (index + 1)}]${timestamp}`.gray);

      if (message.role === "user") {
        console.log(`${"👤 USER:".blue.bold}`);
      } else if (message.role === "assistant" && message.compacted) {
        console.log(`${"📦 COMPACTED SUMMARY:".yellow.bold}`);
      } else if (message.role === "assistant") {
        console.log(`${"🤖 ASSISTANT:".blue.bold}`);
      } else if (message.role === "assistant_with_tool") {
        console.log(`${"🤖 ASSISTANT WITH TOOL:".blue.bold}`);
      } else if (message.role === "tool") {
        console.log(`${"🔧 TOOL RESPONSE:".magenta.bold}`);
      } else {
        console.log(`${"📋 " + message.role.toUpperCase() + ":".yellow.bold}`);
      }

      if (message.role === "assistant_with_tool") {
        if (message.content.kwargs) {
          if (message.content.kwargs.content) {
            console.log(message.content.kwargs.content);
          }
          if (message.content.kwargs.tool_calls && Array.isArray(message.content.kwargs.tool_calls)) {
            message.content.kwargs.tool_calls.forEach(toolCall => {
              const params = Object.entries(toolCall.args || {})
                .map(([key, value]) => {
                  // Truncate very long values for display only
                  const displayValue = typeof value === "string" && value.length > 100 
                    ? value.substring(0, 100) + "...[truncated for display]"
                    : value;
                  return `${key.gray}: ${displayValue.yellow}`;
                })
                .join(", ");
              console.log(`\n${"🔧 INVOKE TOOL:".magenta.bold}\n${toolCall.name.cyan}(${params})`);
            });
          }
        }
      } else if (message.role === "tool") {
        if (message.content && message.content.kwargs && message.content.kwargs.content) {
          const content = message.content.kwargs.content;
          if (typeof content === "string") {
            console.log(content.trim());
          } else if (Array.isArray(content)) {
            content.forEach(item => {
              if (item.type === "text") {
                console.log(item.text.trim());
              } else if (item.type === "image_url" && item.image_url?.url) {
                const dataUrlMatch = item.image_url.url.match(/^data:image\/([^;]+);base64,/);
                const imageType = dataUrlMatch ? dataUrlMatch[1] : "unknown";
                console.log(`📷 Image (${imageType})`.cyan);
              }
            });
          } else if (content.type === "image_url" && content.image_url?.url) {
            const dataUrlMatch = content.image_url.url.match(/^data:image\/([^;]+);base64,/);
            const imageType = dataUrlMatch ? dataUrlMatch[1] : "unknown";
            console.log(`📷 Image (${imageType})`.cyan);
          } else {
            console.log(JSON.stringify(content, null, 2));
          }
        } else if (message.content && typeof message.content.content === "string") {
          try {
            const parsedContent = JSON.parse(message.content.content);
            if (parsedContent.kwargs) {
              if (Array.isArray(parsedContent.kwargs.content)) {
                parsedContent.kwargs.content.forEach(item => {
                  if (item.type === "text") {
                    console.log(item.text.trim());
                  } else if (item.type === "image_url") {
                    const dataUrlMatch = item.image_url.url.match(/^data:image\/([^;]+);base64,/);
                    const imageType = dataUrlMatch ? dataUrlMatch[1] : "unknown";
                    console.log(`📷 Image (${imageType})`.cyan);
                  }
                });
              } else if (typeof parsedContent.kwargs.content === "string") {
                console.log(parsedContent.kwargs.content.trim());
              }
            } else {
              console.log(message.content.content.trim());
            }
          } catch {
            console.log(message.content.content.trim());
          }
        } else if (message.content && typeof message.content === "string") {
          try {
            const parsedContent = JSON.parse(message.content);
            if (parsedContent.kwargs) {
              if (Array.isArray(parsedContent.kwargs.content)) {
                parsedContent.kwargs.content.forEach(item => {
                  if (item.type === "text") {
                    console.log(item.text.trim());
                  } else if (item.type === "image_url") {
                    const dataUrlMatch = item.image_url.url.match(/^data:image\/([^;]+);base64,/);
                    const imageType = dataUrlMatch ? dataUrlMatch[1] : "unknown";
                    console.log(`📷 Image (${imageType})`.cyan);
                  }
                });
              } else if (typeof parsedContent.kwargs.content === "string") {
                console.log(parsedContent.kwargs.content.trim());
              }
            } else {
              console.log(message.content.trim());
            }
          } catch {
            console.log(message.content.trim());
          }
        }
      } else if (message.content) {
        if (typeof message.content === "string") {
          console.log(message.content.trim());
        } else if (Array.isArray(message.content)) {
          message.content.forEach(content => {
            if (content.type === "text") {
              console.log(content.text.trim());
            } else if (content.type === "tool_use") {
              console.log(`${"🔧 TOOL CALLED:".magenta.bold} ${content.name}`);
            } else if (content.type === "tool_result") {
              console.log(`${"🔧 TOOL RESULT:".magenta.bold}`);
              if (content.content) {
                if (typeof content.content === "string") {
                  console.log(content.content.trim());
                } else {
                  console.log("(non-text result)");
                }
              }
            } else {
              console.log(`${"ℹ️  CONTENT:".cyan.bold} ${content.type || "unknown"}`);
            }
          });
        } else {
          console.log("(complex content - format not supported)");
        }
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        message.tool_calls.forEach(toolCall => {
          console.log(`${"🔧 TOOL CALLED:".magenta.bold} ${toolCall.function?.name || "unknown"}`);
        });
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Error: History file '${historyFile}' not found`.red);
    } else if (error instanceof SyntaxError) {
      console.error(`Error: Invalid JSON in history file '${historyFile}'`.red);
    } else {
      console.error(`Error reading history file: ${error.message}`.red);
    }
    process.exit(1);
  }
};

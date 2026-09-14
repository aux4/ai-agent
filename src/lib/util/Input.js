import { runtimeRequestInput } from "../RuntimeContext.js";

export async function readStdIn() {
  const injected = runtimeRequestInput();
  if (injected !== undefined) return injected;
  return read(process.openStdin());
}

async function read(buffer) {
  return new Promise((resolve, reject) => {
    let inputString = "";

    buffer.on("data", data => {
      inputString += data;
    });

    buffer.on("error", error => {
      reject(error);
    });

    buffer.on("end", () => {
      resolve(inputString);
    });
  });
}

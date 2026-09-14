let requestInput;
let warmRuntime = false;

export function setRuntimeRequestContext({ stdin, warm } = {}) {
  requestInput = stdin;
  warmRuntime = warm === true;
}

export function clearRuntimeRequestContext() {
  requestInput = undefined;
  warmRuntime = false;
}

export function runtimeRequestInput() {
  return requestInput;
}

export function isWarmRuntimeRequest() {
  return warmRuntime;
}

// BigInt fields (views, file_size) are not natively JSON-serializable. Same shim as Nest's main.ts.
export function installBigIntJson(): void {
  (BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
    return Number(this);
  };
}

installBigIntJson();

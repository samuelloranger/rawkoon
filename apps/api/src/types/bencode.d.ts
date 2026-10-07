// bencode v4 ships no types and @types/bencode is stale; only the surface we use.
declare module "bencode" {
  type Bencodable =
    | number
    | string
    | Uint8Array
    | Bencodable[]
    | { [key: string]: Bencodable };

  const bencode: {
    decode(data: Uint8Array): unknown;
    encode(data: Bencodable): Uint8Array;
  };
  export default bencode;
}

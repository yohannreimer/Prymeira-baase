declare module "ipaddr.js" {
  type Address = {
    kind(): "ipv4" | "ipv6";
    range(): string;
    toByteArray(): number[];
  };

  const ipaddr: {
    parse(address: string): Address;
    isValid(address: string): boolean;
  };
  export default ipaddr;
}

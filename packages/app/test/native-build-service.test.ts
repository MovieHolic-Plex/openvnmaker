import {test} from "node:test";
import assert from "node:assert/strict";
import {nativeRequestAllowed} from "../native-build-plugin.js";
test("native execution is restricted to loopback hosts and same-origin browser requests",()=>{
  const request=(remoteAddress:string,host:string,origin?:string,site?:string)=>({socket:{remoteAddress},headers:{host,...(origin?{origin}:{}),...(site?{"sec-fetch-site":site}:{})}} as Parameters<typeof nativeRequestAllowed>[0]);
  assert.equal(nativeRequestAllowed(request("127.0.0.1","127.0.0.1:5184","http://127.0.0.1:5184")),true);
  assert.equal(nativeRequestAllowed(request("::ffff:127.0.0.1","localhost:5184")),true);
  assert.equal(nativeRequestAllowed(request("192.168.1.10","localhost:5184")),false);
  assert.equal(nativeRequestAllowed(request("127.0.0.1","malicious.example:5184")),false);
  assert.equal(nativeRequestAllowed(request("127.0.0.1","localhost:5184","https://example.com")),false);
  assert.equal(nativeRequestAllowed(request("127.0.0.1","localhost:5184",undefined,"cross-site")),false);
});

import {createServer} from "node:http";
import {nativeBuildPlugin} from "../../native-build-plugin.js";
let handler:(...args:any[])=>void=()=>undefined;
const server=createServer((req,res)=>handler(req,res,()=>{res.statusCode=404;res.end();}));
const plugin=nativeBuildPlugin(process.argv[2]!,undefined);
(plugin.configureServer as Function)({middlewares:{use:(middleware:any)=>{handler=middleware;}},httpServer:server});
server.listen(0,"127.0.0.1",()=>console.log(JSON.stringify(server.address())));
process.on("SIGTERM",()=>server.close(()=>process.exit(0)));

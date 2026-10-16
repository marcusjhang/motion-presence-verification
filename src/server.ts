import {createServer, IncomingMessage, ServerResponse} from "node:http";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import QRCode from "qrcode";
import {Store,digest,evaluate,opaque,safeEqual,type Method} from "./core.js";

export const store=new Store();
const serverSecret=process.env.MPV_SERVER_SECRET??"local-development-secret";
const publishableKey="pk_local_demo";
const allowedOrigin=process.env.MPV_ORIGIN??"http://localhost:3000";
const actions=new Set(["demo_purchase"]);
const demoAlternativeCode=process.env.MPV_DEMO_ALTERNATIVE_CODE??"246810";
const json=(res:ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"});res.end(JSON.stringify(data));};
async function body(req:IncomingMessage):Promise<any>{let text="";for await(const c of req){text+=c;if(text.length>262144)throw Error("too_large");}return JSON.parse(text||"{}");}
const publicSession=(s:ReturnType<Store["create"]>)=>({sessionId:s.id,expiresAt:new Date(s.expiresAt).toISOString(),status:s.status,description:s.description,action:s.action,challengeId:s.challengeId,targets:s.challenge.map((t,i)=>i?{locked:true}:{...t})});
function auth(req:IncomingMessage):boolean{return safeEqual(String(req.headers.authorization??""),`Bearer ${serverSecret}`)}

export async function handler(req:IncomingMessage,res:ServerResponse):Promise<void>{
 try{
  const url=new URL(req.url??"/",allowedOrigin); const origin=String(req.headers.origin??allowedOrigin);
  if(req.method==="GET"&&url.pathname==="/"){res.writeHead(200,{"content-type":"text/html"});res.end(await readFile(fileURLToPath(new URL("./public/index.html",import.meta.url))));return;}
  if(req.method==="GET"&&url.pathname==="/app.js"){res.writeHead(200,{"content-type":"text/javascript","cache-control":"no-store"});res.end(await readFile(fileURLToPath(new URL("./public/app.js",import.meta.url))));return;}
  if(req.method==="GET"&&url.pathname==="/health"){return json(res,200,{status:"ok"});}
  if(req.method==="POST"&&url.pathname==="/v1/sessions"){
   const b=await body(req); if(origin!==allowedOrigin)return json(res,403,{code:"ORIGIN_NOT_ALLOWED"});
   if(b.siteKey!==publishableKey||!actions.has(b.action)||typeof b.transactionId!=="string"||b.transactionId.length>128)return json(res,400,{code:"INVALID_REQUEST"});
   return json(res,201,publicSession(store.create({origin,action:b.action,description:b.actionDescription,transactionId:b.transactionId})));
  }
  const match=url.pathname.match(/^\/v1\/sessions\/([^/]+)(?:\/(attempts|handoff|alternative|cancel))?$/); const s=match&&store.get(match[1]!);
  if(match&&!s)return json(res,404,{code:"INVALID_REQUEST"});
  if(req.method==="GET"&&match&&!match[2]){const step=Math.max(0,Math.min(2,Number(url.searchParams.get("step")??0)));return json(res,200,{...publicSession(s!),targets:[s!.challenge[step]],resultToken:s!.status==="succeeded"?s!.resultToken:undefined});}
  if(req.method==="POST"&&match?.[2]==="attempts"){
   const b=await body(req);
   if(b.invalidate===true){store.freshAttempt(s!);return json(res,200,{status:s!.status,challengeId:s!.challengeId});}
   if(!["pending","connected","challenging"].includes(s!.status))return json(res,409,{code:"ATTEMPT_REJECTED"});s!.status="challenging";
   const ok=b.challengeId===s!.challengeId&&evaluate(s!.challenge,b.samples,Date.now());
   if(!ok){s!.failures++;store.freshAttempt(s!);return json(res,422,{code:"ATTEMPT_REJECTED",failures:s!.failures,challengeId:s!.challengeId});}
   return json(res,200,{status:"confirmed",resultToken:store.succeed(s!,b.method==="qr"?"qr_motion":"direct_motion")});
  }
  if(req.method==="POST"&&match?.[2]==="handoff") {if(!["pending","connected","challenging"].includes(s!.status))return json(res,409,{code:"ATTEMPT_REJECTED"});const token=opaque();s!.handoffHash=digest(token);s!.phoneId=undefined;s!.status="pending";store.freshAttempt(s!);const link=`${allowedOrigin}/?handoff=${s!.id}#${token}`;return json(res,200,{link,qr:await QRCode.toDataURL(link),expiresAt:new Date(s!.expiresAt).toISOString()});}
  if(req.method==="POST"&&url.pathname==="/v1/handoffs/connect"){const b=await body(req);const hs=store.get(b.sessionId);if(!hs||hs.handoffHash!==digest(b.token))return json(res,410,{code:"SESSION_EXPIRED"});if(hs.phoneId&&hs.phoneId!==b.phoneId)return json(res,409,{code:"PHONE_CONFLICT"});hs.phoneId=b.phoneId;hs.status="connected";return json(res,200,publicSession(hs));}
  if(req.method==="POST"&&match?.[2]==="alternative"){if(!auth(req))return json(res,401,{code:"INVALID_REQUEST"});const b=await body(req);const method:Method=b.method;if(method!=="reviewed_accessibility")return json(res,400,{code:"INVALID_REQUEST"});return json(res,200,{resultToken:store.succeed(s!,method)});}
  if(req.method==="POST"&&match?.[2]==="cancel"){if(!["consumed","expired"].includes(s!.status))s!.status="cancelled";return json(res,200,{status:s!.status});}
  if(req.method==="POST"&&url.pathname==="/v1/results/redeem"){if(!auth(req))return json(res,401,{code:"INVALID_REQUEST"});const b=await body(req);return json(res,200,store.redeem(b.resultToken,{origin:b.origin,action:b.action,transactionId:b.transactionId,idempotencyKey:String(req.headers["idempotency-key"]??"")}));}
  if(req.method==="POST"&&url.pathname==="/demo/purchase") {const b=await body(req);const result=store.redeem(b.resultToken,{origin:allowedOrigin,action:"demo_purchase",transactionId:b.transactionId,idempotencyKey:`purchase:${b.transactionId}`}) as {outcome:string};return result.outcome==="valid_consumed"?json(res,200,{purchased:true,transactionId:b.transactionId}):json(res,403,{purchased:false,outcome:result.outcome});}
  if(req.method==="POST"&&url.pathname==="/demo/alternative") {const b=await body(req);const as=store.get(b.sessionId);if(!as||as.transactionId!==b.transactionId)return json(res,404,{code:"INVALID_REQUEST"});if(typeof b.code!=="string"||!safeEqual(b.code,demoAlternativeCode))return json(res,401,{code:"ALTERNATIVE_NOT_VERIFIED"});return json(res,200,{resultToken:store.succeed(as,"reviewed_accessibility")});}
  json(res,404,{code:"NOT_FOUND"});
 }catch(e){json(res,400,{code:"INVALID_REQUEST"});}
}
if(process.env.NODE_ENV!=="test")createServer(handler).listen(Number(process.env.PORT??3000),()=>console.log("Motion Presence demo: http://localhost:3000"));

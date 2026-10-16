import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type Method = "direct_motion" | "qr_motion" | "reviewed_accessibility";
export type Direction = "left" | "right" | "up" | "down" | "center";
export interface Target { direction: Direction; x: number; y: number }
export interface Sample { t: number; x: number; y: number; visible: boolean; angle: 0|90|180|270 }
export interface Session {
  id: string; origin: string; action: string; description: string; transactionId: string;
  expiresAt: number; status: "pending"|"connected"|"challenging"|"succeeded"|"cancelled"|"expired"|"consumed";
  challenge: Target[]; challengeId: string; failures: number; handoffHash?: string; phoneId?: string;
  resultHash?: string; resultToken?: string; method?: Method;
}

const vectors: Record<Direction, [number, number]> = {left:[-1,0],right:[1,0],up:[0,-1],down:[0,1],center:[0,0]};
export const opaque = (bytes=24): string => randomBytes(bytes).toString("base64url");
export const digest = (value:string): string => createHash("sha256").update(value).digest("hex");
export function challenge(random:()=>number=Math.random): Target[] {
  const dirs: Direction[] = ["left","right","up","down"];
  const first = dirs[Math.floor(random()*dirs.length)]!;
  const remaining = dirs.filter(d=>d!==first);
  const second = remaining[Math.floor(random()*remaining.length)]!;
  const sequence: Direction[] = [first, second, "center"];
  return sequence.map(direction=>({direction,x:vectors[direction][0]*8,y:vectors[direction][1]*8}));
}
export function evaluate(targets: readonly Target[], samples: readonly Sample[], now:number): boolean {
  if (samples.length < 6 || samples.length > 1000) return false;
  let index=0, dwellStart:number|undefined, last=-1, angle=samples[0]!.angle;
  for (const s of samples) {
    if (!s.visible || s.angle!==angle || s.t<=last || s.t>now+1000) return false;
    last=s.t;
    const target=targets[index]; if (!target) break;
    const distance=Math.hypot(s.x-target.x,s.y-target.y);
    if (distance<=3) { dwellStart ??= s.t; if (s.t-dwellStart>=120) { index++; dwellStart=undefined; } }
    else dwellStart=undefined;
  }
  const duration=samples.at(-1)!.t-samples[0]!.t;
  return index===targets.length && duration>=360 && duration<=10_000;
}
export class Store {
  readonly sessions = new Map<string,Session>();
  readonly idempotency = new Map<string,unknown>();
  constructor(private readonly now:()=>number=Date.now) {}
  create(input:{origin:string;action:string;description?:string;transactionId:string}):Session {
    const s:Session={id:opaque(),origin:input.origin,action:input.action,description:input.description??input.action,
      transactionId:input.transactionId,expiresAt:this.now()+120_000,status:"pending",challenge:challenge(),challengeId:opaque(),failures:0};
    this.sessions.set(s.id,s); return s;
  }
  get(id:string):Session|undefined { const s=this.sessions.get(id); if(s&&s.status!=="consumed"&&s.status!=="cancelled"&&this.now()>=s.expiresAt)s.status="expired"; return s; }
  freshAttempt(s:Session):void {
    if (["succeeded","cancelled","expired","consumed"].includes(s.status)) throw new Error("invalid_state");
    s.challenge=challenge();s.challengeId=opaque();s.status=s.phoneId?"connected":"pending";
  }
  succeed(s:Session,method:Method):string { if(!["pending","connected","challenging"].includes(s.status)) throw new Error("invalid_state"); const token=opaque(); s.status="succeeded";s.method=method;s.resultHash=digest(token);s.resultToken=token;return token; }
  redeem(token:string,input:{origin:string;action:string;transactionId:string;idempotencyKey:string}):unknown {
    const prior=this.idempotency.get(input.idempotencyKey); if(prior)return prior;
    const hash=digest(token); const s=[...this.sessions.values()].find(x=>x.resultHash===hash);
    let result:unknown;
    if(!s) result={outcome:"invalid"};
    else if(s.status==="consumed") result={outcome:"already_consumed"};
    else if(this.now()>=s.expiresAt) {s.status="expired";result={outcome:"expired"};}
    else if(s.status==="cancelled") result={outcome:"cancelled"};
    else if(s.origin!==input.origin) result={outcome:"wrong_site"};
    else if(s.action!==input.action||s.transactionId!==input.transactionId) result={outcome:"wrong_action"};
    else {s.status="consumed";s.resultToken=undefined;result={outcome:"valid_consumed",action:s.action,transactionId:s.transactionId,method:s.method,completedAt:new Date(this.now()).toISOString()};}
    if ((result as {outcome?:string}).outcome === "valid_consumed") this.idempotency.set(input.idempotencyKey,result);
    return result;
  }
}
export function safeEqual(a:string,b:string):boolean { const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y); }

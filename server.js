// Máy chủ nhỏ: giữ API key bí mật, xoay vòng nhiều key Gemini, phục vụ index.html. Không cần cài thư viện.
// Biến môi trường (Render → Environment):
//   GEMINI_API_KEYS = key1,key2,key3   (cách nhau dấu phẩy; cũng nhận GEMINI_API_KEY và GEMINI_API_KEY_1..10)
//   GEMINI_MODEL (mặc định gemini-flash-latest), GEMINI_FALLBACK (mặc định gemini-flash-lite-latest)
//   RATE_LIMIT (số lượt/10 phút/IP, mặc định 40), ADMIN_TOKEN (để xem /api/status?t=...)
const http=require('http'),fs=require('fs'),path=require('path');
const MODEL=process.env.GEMINI_MODEL||'gemini-flash-latest',PORT=process.env.PORT||3000;
const KEYS=[...new Set([process.env.GEMINI_API_KEYS,process.env.GEMINI_API_KEY,...Array.from({length:10},(_,i)=>process.env['GEMINI_API_KEY_'+(i+1)])].filter(Boolean).join(',').split(',').map(x=>x.trim()).filter(Boolean))];
const lv=n=>`Trình độ HSK 3.0 bậc ${n} (hệ 9 bậc theo Tiêu chuẩn trình độ tiếng Trung giáo dục quốc tế 2021; bậc 1-3 sơ cấp, 4-6 trung cấp, 7-9 cao cấp): chỉ dùng từ vựng và ngữ pháp trong phạm vi bậc ${n} (bậc 1-2: câu rất ngắn 4-10 chữ; bậc 3-4: độ dài vừa; bậc 5+: tự nhiên, phong phú). Chữ giản thể.`;
const P={
scenario:b=>`Tạo tình huống luyện nói tiếng Trung. Mô tả của người học: "${b.desc}". `+(b.grammar?`Cấu trúc ngữ pháp BẮT BUỘC luyện: "${b.grammar}". `:'')+lv(b.level)+`
Trả về JSON: {"emoji":"1 emoji","title":"tiêu đề tiếng Trung ngắn","titleVi":"nghĩa tiếng Việt","context":"bối cảnh tiếng Trung 2-3 câu","contextVi":"bản dịch tiếng Việt","partner":"tên và vai của nhân vật, ví dụ 小明 · 中国大学生","goals":["3 mục tiêu ngắn bằng tiếng Trung"],"grammar":[{"pattern":"công thức cấu trúc","meaning":"giải thích tiếng Việt ngắn","example":"ví dụ tiếng Trung","exampleVi":"bản dịch"}],"dialogue":[{"role":"npc","zh":"","pinyin":"","vi":"","hl":""}]}
dialogue gồm 8 lượt xen kẽ, bắt đầu bằng "npc", role chỉ là "npc" hoặc "me" (me là người học), kết thúc bằng "npc".
`+(b.grammar?'Mọi lượt "me" PHẢI dùng đúng cấu trúc cần luyện (đúng ngữ pháp, mỗi câu một ngữ cảnh khác nhau); lượt npc khéo gợi ra cơ hội dùng cấu trúc đó. Trường "hl" của lượt me là cụm chữ Trung trong zh thể hiện cấu trúc (chép nguyên văn từ zh); lượt npc để "hl" rỗng.':'Không có cấu trúc yêu cầu: "grammar" là [] và "hl" để rỗng.'),
ask:b=>`Bạn là giáo viên tiếng Trung thân thiện. Người học (${lv(b.level)}) hỏi về bài hội thoại sau.
Bối cảnh: ${b.context}
Hội thoại: ${JSON.stringify(b.lines)}
`+(b.focus?`Cấu trúc đang luyện: ${b.focus}. `:'')+(b.line?`Người học đang hỏi về câu: "${b.line}". `:'')+`
Các hỏi đáp trước: ${JSON.stringify(b.qa)}
Câu hỏi của người học: "${b.question}"
Trả lời bằng tiếng Việt, ngắn gọn dễ hiểu (khoảng 150 từ), nêu chữ Trung kèm Pinyin cho từ hoặc cấu trúc được nhắc, kèm 1-2 ví dụ ngắn có dịch. Dùng **in đậm** cho từ khóa và xuống dòng để dễ đọc. Nếu câu hỏi không liên quan tiếng Trung, nhẹ nhàng đưa người học về bài.
Trả về JSON: {"answer":"nội dung trả lời"}`,
chat:b=>`Bạn đóng vai ${b.partner} trong tình huống: ${b.context}. Trò chuyện tự nhiên bằng tiếng Trung với người học. ${lv(b.level)} Mỗi lần chỉ nói 1-2 câu ngắn và hỏi tiếp để duy trì hội thoại. Người học nói sai thì vẫn đáp tự nhiên.
`+(b.focus?`Người học đang luyện cấu trúc: ${b.focus}. Hãy hỏi khéo để họ có cơ hội dùng cấu trúc này, và các câu gợi ý (suggestions) cũng dùng cấu trúc đó. `:'')+`Lịch sử (role "me" là người học): ${JSON.stringify(b.history)}
${b.history.length?'Hãy đáp lại lượt cuối của người học.':'Hãy mở đầu cuộc trò chuyện.'}
Trả về JSON: {"zh":"","pinyin":"","vi":"bản dịch tiếng Việt","suggestions":["3 câu người học có thể đáp, tiếng Trung, đúng trình độ"]}`,
feedback:b=>`Nhận xét bằng tiếng Việt buổi hội thoại tiếng Trung sau của người học (${lv(b.level)}): ${JSON.stringify(b.history)}
`+(b.focus?`Cấu trúc đang luyện: ${b.focus}. Thêm trường "grammar" nhận xét người học dùng cấu trúc này đúng/sai mấy lần. `:'')+`Trả về JSON: {"score":số 0-100,"good":"điểm tốt","fixes":[{"said":"câu người học","better":"câu sửa tiếng Trung","why":"giải thích ngắn tiếng Việt"}],"tip":"lời khuyên"}`};
const TEMP={scenario:0.8,chat:0.8,ask:0.3,feedback:0.3};
const MODELS=[MODEL,...(process.env.GEMINI_FALLBACK||'gemini-flash-lite-latest').split(',').map(x=>x.trim()).filter(x=>x&&x!==MODEL)];
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now();

/* ---------- xoay vòng key ----------
   cool["<key>|<model>"]: tạm nghỉ khi bị 429 (quota tính theo từng model)
   bad[<key>]: key sai/bị khóa (400 API key, 401, 403) → nghỉ 1 giờ
   Thứ tự thử: model chính trên lần lượt các key, hết mới sang model dự phòng. */
const cool={},bad={};let rr=0;
const url=m=>`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
async function gem(prompt,temp){
 if(!KEYS.length)throw new Error('Thiếu biến GEMINI_API_KEYS trên Render.');
 const t0=now(),start=rr++%KEYS.length;let last='',think=true,rate=false,tried=0;
 outer:for(const model of MODELS){
  for(let n=0;n<KEYS.length;n++){
   const ki=(start+n)%KEYS.length,id=ki+'|'+model;
   if((bad[ki]||0)>now()||(cool[id]||0)>now())continue;
   for(let t=0;t<2;t++){
    if(now()-t0>55000){last=last||'Gemini phản hồi quá lâu';break outer}
    tried++;
    const cfg={responseMimeType:'application/json',temperature:temp};if(think)cfg.thinkingConfig={thinkingBudget:0};
    let r;try{r=await fetch(url(model),{method:'POST',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json','x-goog-api-key':KEYS[ki]},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:cfg})})}
    catch(e){last=`key#${ki+1} ${model}: không phản hồi kịp`;console.error('[gemini]',last);break}
    if(r.ok){const j=await r.json().catch(()=>({}));const x=(j.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
     try{return JSON.parse(x.replace(/```json|```/g,'').trim())}catch{last='AI trả về dữ liệu lỗi, thử lại.';continue}}
    let m='';try{m=(await r.json()).error?.message||''}catch{}
    last=`key#${ki+1} ${model}: ${r.status} ${m}`.slice(0,300);console.error('[gemini]',last);
    if((r.status===400&&/api key/i.test(m))||r.status===401||r.status===403){bad[ki]=now()+3600e3;break}      // key hỏng → bỏ qua 1 giờ
    if(r.status===400&&think){think=false;t--;continue}                                                       // model không nhận tắt suy nghĩ → thử lại không có
    if(r.status===404)continue outer;                                                                         // model không tồn tại → sang model khác
    if(r.status===429){rate=true;cool[id]=now()+(/per ?day|daily/i.test(m)?3600e3:60e3);break}                // hết lượt → key này nghỉ, thử key kế
    if(r.status>=500){await sleep(800*(t+1));continue}
    break;
   }
  }
 }
 if(KEYS.every((_,i)=>(bad[i]||0)>now()))throw new Error('API key không hợp lệ hoặc bị khóa, kiểm tra GEMINI_API_KEYS trên Render.');
 if(rate||!tried)throw Object.assign(new Error('Tất cả key AI đang hết lượt tạm thời, thử lại sau ít phút.'),{code:429});
 throw new Error(/\b5\d\d\b|kịp|quá/.test(last)?'Gemini đang quá tải hoặc chậm, thử lại sau ít phút.':last.startsWith('AI trả')?last:'AI gặp lỗi, thử lại nhé.');
}

/* ---------- giới hạn tốc độ theo IP + cache tình huống mẫu dùng chung ---------- */
const RL=new Map(),RLMAX=+process.env.RATE_LIMIT||40;
const ipOf=req=>String(req.headers['cf-connecting-ip']||req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
function limited(ip){const t=now(),e=RL.get(ip);if(!e||e.r<t){RL.set(ip,{n:1,r:t+600000});return false}return ++e.n>RLMAX}
setInterval(()=>{const t=now();for(const[k,e]of RL)if(e.r<t)RL.delete(k)},60000).unref();
const SC=new Map();   // tình huống mẫu: sinh 1 lần, mọi người dùng chung (mất khi server khởi động lại)

const HTML=fs.readFileSync(path.join(__dirname,'index.html'));
const admin=req=>{const tk=process.env.ADMIN_TOKEN;return tk&&new URL(req.url,'http://x').searchParams.get('t')===tk};
http.createServer((req,res)=>{
 const send=(c,o)=>{if(res.headersSent)return;res.writeHead(c,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(o))};
 if(req.method==='POST'&&req.url==='/api/ai'){
  if(limited(ipOf(req))){req.resume();return send(429,{error:'Bạn thao tác hơi nhanh, chờ vài phút rồi thử lại.'})}
  let body='',big=false;
  req.on('data',c=>{if(big)return;body+=c;if(body.length>30000){big=true;body='';send(413,{error:'Nội dung gửi lên quá dài.'})}});
  req.on('end',async()=>{if(big)return;
   try{
    const b=JSON.parse(body||'{}');if(!P[b.task])return send(400,{error:'Yêu cầu không hợp lệ'});
    b.question=String(b.question||'').slice(0,500);b.line=String(b.line||'').slice(0,200);b.context=String(b.context||'').slice(0,400);b.partner=String(b.partner||'').slice(0,100);b.lines=(Array.isArray(b.lines)?b.lines:[]).slice(0,40).map(x=>String(x).slice(0,120));b.qa=(Array.isArray(b.qa)?b.qa:[]).slice(-6).map(x=>({q:String(x&&x.q||'').slice(0,300),a:String(x&&x.a||'').slice(0,400)}));b.grammar=String(b.grammar||'').slice(0,300);b.focus=String(b.focus||'').slice(0,300);b.level=Math.min(9,Math.max(1,+b.level||2));b.desc=String(b.desc||'').slice(0,1500);
    b.history=(Array.isArray(b.history)?b.history:[]).slice(-30).map(h=>({role:h&&h.role==='me'?'me':'npc',zh:String(h&&h.zh||'').slice(0,300)}));
    const shared=b.task==='scenario'&&b.shared===true&&!b.grammar,ck=b.level+'|'+b.desc;
    if(shared&&SC.has(ck))return send(200,SC.get(ck));
    const out=await gem(P[b.task](b),TEMP[b.task]);
    if(shared){if(SC.size>200)SC.clear();SC.set(ck,out)}
    send(200,out);
   }catch(e){console.error('[api]',e.message);send(Number.isInteger(e.code)?e.code:500,{error:e.message||'Lỗi máy chủ'})}});
  return;}
 if(req.url==='/api/health'){res.end('ok');return}
 if(req.url.startsWith('/api/status')){   // xem tình trạng key: /api/status?t=<ADMIN_TOKEN> (không lộ nội dung key)
  if(!admin(req)){res.writeHead(404);res.end();return}
  return send(200,{keys:KEYS.length,models:MODELS,sharedScenarios:SC.size,state:KEYS.map((_,i)=>({key:'#'+(i+1),badForSec:Math.max(0,((bad[i]||0)-now())/1000|0),coolingSec:Object.fromEntries(MODELS.map(m=>[m,Math.max(0,((cool[i+'|'+m]||0)-now())/1000|0)]))}))})}
 if(req.url.startsWith('/api/models')){   // liệt kê model dùng được (cần ADMIN_TOKEN)
  if(!admin(req)||!KEYS.length){res.writeHead(404);res.end();return}
  (async()=>{try{const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',{headers:{'x-goog-api-key':KEYS[0]}});const j=await r.json();send(200,r.ok?{current:MODEL,usable:(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace('models/',''))}:j)}catch(e){send(500,{error:String(e)})}})();return}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(HTML);
}).listen(PORT,()=>console.log('http://localhost:'+PORT+' · '+KEYS.length+' key Gemini'));

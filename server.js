// Máy chủ nhỏ: giữ API key bí mật, gọi Gemini, phục vụ index.html. Không cần cài thư viện.
const http=require('http'),fs=require('fs'),path=require('path');

// ===== NHIỀU KEY + XOAY VÒNG =====
// Đặt trên Render: GEMINI_API_KEYS = key1,key2,key3  (cách nhau bằng dấu phẩy)
// Biến cũ GEMINI_API_KEY (1 key) vẫn dùng được; nếu có cả hai thì gộp lại.
const KEYS=[...new Set([process.env.GEMINI_API_KEYS,process.env.GEMINI_API_KEY].filter(Boolean).join(',')
 .split(/[,;\s]+/).map(x=>x.trim().replace(/^["']|["']$/g,'')).filter(Boolean))];
const MODEL=process.env.GEMINI_MODEL||'gemini-flash-latest',PORT=process.env.PORT||3000;
let rr=0;                       // con trỏ xoay vòng: mỗi lượt gọi bắt đầu từ key kế tiếp (chia đều tải)
const cool=new Map();           // "chỉ số key|model" -> thời điểm được dùng lại (hết quota của model đó)
const dead=new Map();           // chỉ số key -> thời điểm được dùng lại (key sai/bị khóa)
function pickKey(model){        // trả về chỉ số key dùng được cho model này, hoặc -1 nếu key nào cũng đang nghỉ
 const n=Date.now();
 for(let j=0;j<KEYS.length;j++){
  const i=(rr+j)%KEYS.length;
  if((dead.get(i)||0)>n||(cool.get(i+'|'+model)||0)>n)continue;
  rr=(i+1)%KEYS.length;return i}
 return -1}
const coolKey=(i,model,ms)=>cool.set(i+'|'+model,Date.now()+ms);
const killKey=(i,ms)=>dead.set(i,Date.now()+ms);
const QUOTA_COOL=30000;         // key hết lượt → nghỉ 30 giây rồi thử lại (với model đó)
const BADKEY_COOL=600000;       // key sai/bị khóa → nghỉ 10 phút

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
`+(b.focus?`Người học đang luyện cấu trúc: ${b.focus}. Hãy hỏi khéo để họ có cơ hội dùng cấu trúc này. `:'')+`Lịch sử (role "me" là người học): ${JSON.stringify(b.history)}
${b.history.length?'Hãy đáp lại lượt cuối của người học.':'Hãy mở đầu cuộc trò chuyện.'}
Chỉ viết đúng lời nhân vật bằng chữ Hán giản thể, không pinyin, không dịch, không giải thích, không JSON.`,
notes:b=>`Bối cảnh: ${b.context}. Nhân vật ${b.partner} vừa nói: "${b.zh}". ${lv(b.level)}
`+(b.focus?`Người học đang luyện cấu trúc: ${b.focus}; các câu gợi ý cũng dùng cấu trúc đó. `:'')+`Lịch sử trước đó (role "me" là người học): ${JSON.stringify(b.history)}
Trả về JSON: {"pinyin":"pinyin của câu nhân vật vừa nói","vi":"bản dịch tiếng Việt","suggestions":["3 câu người học có thể đáp, tiếng Trung, đúng trình độ"]}`,
feedback:b=>`Nhận xét bằng tiếng Việt buổi hội thoại tiếng Trung sau của người học (${lv(b.level)}): ${JSON.stringify(b.history)}
`+(b.focus?`Cấu trúc đang luyện: ${b.focus}. Thêm trường "grammar" nhận xét người học dùng cấu trúc này đúng/sai mấy lần. `:'')+`Trả về JSON: {"score":số 0-100,"good":"điểm tốt","fixes":[{"said":"câu người học","better":"câu sửa tiếng Trung","why":"giải thích ngắn tiếng Việt"}],"tip":"lời khuyên"}
Yêu cầu: rất ngắn gọn. "good" và "tip" mỗi cái 1 câu; "fixes" tối đa 3 lỗi quan trọng nhất, "why" dưới 20 chữ; chỉ xét các lượt của người học (role "me"), bỏ qua lời nhân vật.`};

const MODELS=[MODEL,...(process.env.GEMINI_FALLBACK||'gemini-flash-lite-latest').split(',').map(x=>x.trim()).filter(x=>x&&x!==MODEL)];
const CHAT_MODEL=process.env.GEMINI_CHAT_MODEL||'gemini-flash-lite-latest';
const FB=process.env.GEMINI_FEEDBACK_MODEL||CHAT_MODEL;
const FBM=[FB,...MODELS.filter(m=>m!==FB)];
const CHATM=[CHAT_MODEL,...MODELS.filter(m=>m!==CHAT_MODEL)];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const MAXTRY=()=>KEYS.length+3;   // số lần thử tối đa cho mỗi model (đủ để đi hết các key)
const quotaErr=()=>Object.assign(new Error('Hết lượt miễn phí tạm thời (tất cả key), thử lại sau ít phút.'),{code:429});

// Gọi Gemini trả JSON. Thứ tự: với mỗi model → lần lượt các key; key hết lượt thì sang key khác, hết key thì sang model dự phòng.
async function gem(prompt,models=MODELS,maxTok=0){
 let last='',t0=Date.now(),quota=false;
 for(const model of models){let think=true;
  for(let t=0;t<MAXTRY();t++){
   if(Date.now()-t0>55000)throw new Error('Gemini phản hồi quá lâu, thử lại sau ít phút. '+last.slice(0,120));
   const i=pickKey(model);if(i<0)break;                     // mọi key đang nghỉ với model này → model kế
   const cfg={responseMimeType:'application/json',temperature:0.8};if(maxTok)cfg.maxOutputTokens=maxTok;if(think)cfg.thinkingConfig={thinkingBudget:0};
   let r;try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json','x-goog-api-key':KEYS[i]},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:cfg})})}
   catch(e){last=`Model ${model} không phản hồi kịp (25 giây).`;break}
   if(r.ok){const j=await r.json();const x=(j.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
    try{return JSON.parse(x.replace(/```json|```/g,'').trim())}catch{last='AI trả về dữ liệu lỗi, thử lại.';continue}}
   let m='';try{m=(await r.json()).error?.message||''}catch{}
   last=`Gemini lỗi ${r.status} (model: ${model}, key #${i+1}): ${m}`.slice(0,300);
   if(r.status===401||r.status===403||(r.status===400&&/api key/i.test(m))){killKey(i,BADKEY_COOL);console.warn(`Key #${i+1} bị từ chối (${r.status}), tạm nghỉ 10 phút.`);continue}
   if(r.status===400&&think){think=false;t--;continue}      // model không nhận tùy chọn tắt suy nghĩ → thử lại không có
   if(r.status===404)break;
   if(r.status===429){quota=true;coolKey(i,model,QUOTA_COOL);console.warn(`Key #${i+1} hết lượt với ${model}, chuyển key khác.`);continue}
   if(r.status>=500){await sleep(1000*Math.min(t+1,3));continue}
   throw new Error(last);
  }
 }
 if(quota||!last)throw quotaErr();
 throw new Error(/50\d|kịp/.test(last)?'Gemini đang quá tải hoặc chậm, thử lại sau ít phút. ('+last.slice(0,120)+')':last);
}

// Gọi Gemini dạng stream (chỉ cho task "chat"), cũng xoay key như trên.
async function gemStream(prompt,res){
 let last='',quota=false;
 for(const model of CHATM){let think=true;
  for(let t=0;t<MAXTRY();t++){
   const i=pickKey(model);if(i<0)break;
   const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),30000),onClose=()=>ac.abort();res.on('close',onClose);
   const clean=()=>{clearTimeout(tm);res.off('close',onClose)};
   const cfg={temperature:0.8,maxOutputTokens:300};if(think)cfg.thinkingConfig={thinkingBudget:0};
   let r;try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,{method:'POST',signal:ac.signal,headers:{'Content-Type':'application/json','x-goog-api-key':KEYS[i]},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:cfg})})}
   catch{clean();if(res.destroyed)return;last=`Model ${model} không phản hồi kịp.`;break}
   if(!r.ok){clean();let m='';try{m=(await r.json()).error?.message||''}catch{}
    last=`Gemini lỗi ${r.status} (model: ${model}, key #${i+1}): ${m}`.slice(0,300);
    if(r.status===401||r.status===403||(r.status===400&&/api key/i.test(m))){killKey(i,BADKEY_COOL);console.warn(`Key #${i+1} bị từ chối (${r.status}), tạm nghỉ 10 phút.`);continue}
    if(r.status===400&&think){think=false;t--;continue}
    if(r.status===429){quota=true;coolKey(i,model,QUOTA_COOL);continue}
    if(r.status===404)break;
    if(r.status>=500){await sleep(500);continue}
    throw new Error(last)}
   // Chỉ gửi header khi đã có chữ đầu tiên → nếu model trả rỗng thì còn thử được key/model khác.
   let started=false;const dec=new TextDecoder();let buf='';
   try{for await(const ch of r.body){buf+=dec.decode(ch,{stream:true});let k;
    while((k=buf.indexOf('\n'))>=0){const line=buf.slice(0,k).trim();buf=buf.slice(k+1);if(!line.startsWith('data:'))continue;
     try{const j=JSON.parse(line.slice(5));const x=(j.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
      if(x){if(!started){res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});started=true}res.write(x)}}catch{}}}}catch{}
   clean();
   if(started){res.end();return}
   if(res.destroyed)return;
   last=`Model ${model} trả về nội dung rỗng.`;continue;
  }}
 if(quota)throw quotaErr();
 throw new Error(last||'Gemini không phản hồi, thử lại.')}

const HITS=new Map();setInterval(()=>{const n=Date.now();for(const[k,v]of HITS)if(n-v.t>60000)HITS.delete(k)},60000).unref();
function limited(req){const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim(),n=Date.now();let v=HITS.get(ip);if(!v||n-v.t>60000){v={t:n,c:0};HITS.set(ip,v)}return ++v.c>(+process.env.RATE_PER_MIN||40)}

http.createServer((req,res)=>{
 if(req.method==='POST'&&(req.url==='/api/ai'||req.url==='/api/stream')){
  if(limited(req)){res.writeHead(429,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Bạn thao tác hơi nhanh, đợi một chút rồi thử lại.'}))}
  let body='',big=false;req.on('data',c=>{if(big)return;body+=c;if(body.length>20000){big=true;res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Yêu cầu quá dài'}))}});
  req.on('end',async()=>{if(big)return;const send=(c,o)=>{if(res.headersSent)return res.end();res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
   try{if(!KEYS.length)return send(500,{error:'Thiếu biến GEMINI_API_KEYS (hoặc GEMINI_API_KEY) trên Render.'});
    let b;try{b=JSON.parse(body||'{}')}catch{return send(400,{error:'Yêu cầu không hợp lệ'})}
    if(!b||typeof b!=='object'||!P[b.task])return send(400,{error:'Yêu cầu không hợp lệ'});
    b.question=String(b.question||'').slice(0,500);b.line=String(b.line||'').slice(0,200);b.context=String(b.context||'').slice(0,400);b.lines=(Array.isArray(b.lines)?b.lines:[]).slice(0,40).map(x=>String(x).slice(0,120));b.qa=(Array.isArray(b.qa)?b.qa:[]).slice(-6).map(x=>({q:String((x&&x.q)||'').slice(0,300),a:String((x&&x.a)||'').slice(0,400)}));b.grammar=String(b.grammar||'').slice(0,300);b.focus=String(b.focus||'').slice(0,300);b.level=Math.min(9,Math.max(1,+b.level||2));b.desc=String(b.desc||'').slice(0,1500);
    b.partner=String(b.partner||'').slice(0,100);b.zh=String(b.zh||'').slice(0,300);
    b.history=(Array.isArray(b.history)?b.history:[]).slice(-30).map(x=>({role:x&&x.role==='me'?'me':'npc',zh:String((x&&x.zh)||'').slice(0,300)}));
    if(req.url==='/api/stream'){if(b.task!=='chat')return send(400,{error:'Yêu cầu không hợp lệ'});return await gemStream(P.chat(b),res)}
    const out=await gem(P[b.task](b),b.task==='notes'?CHATM:b.task==='feedback'?FBM:MODELS,b.task==='feedback'?1500:0);
    if(b.task==='scenario'&&(!Array.isArray(out.dialogue)||out.dialogue.length<2||out.dialogue.some(d=>!d||!d.zh)))throw new Error('AI tạo bài chưa đúng định dạng, thử lại.');
    send(200,out);
   }catch(e){send(Number.isInteger(e.code)?e.code:500,{error:e.message||'Lỗi máy chủ'})}});
  return;}
 if(req.url==='/api/health'){res.end('ok - '+KEYS.length+' key');return}   // mở /api/health để kiểm tra server đọc được mấy key
 if(req.url==='/api/models'&&process.env.ENABLE_MODELS==='1'){(async()=>{try{const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',{headers:{'x-goog-api-key':KEYS[0]||''}});const j=await r.json();res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(r.ok?{current:MODEL,usable:(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace('models/',''))}:j,null,1))}catch(e){res.end(String(e))}})();return}
 const p0=req.url.split('?')[0];if(p0!=='/'&&p0!=='/index.html'){res.writeHead(404);res.end('not found');return}
 let html;try{html=fs.readFileSync(path.join(__dirname,'index.html'))}catch{res.writeHead(500);res.end('Thiếu file index.html');return}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);
}).listen(PORT,()=>console.log('http://localhost:'+PORT+' | số key đang dùng: '+KEYS.length));

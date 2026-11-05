// Máy chủ nhỏ: giữ API key bí mật, gọi Gemini, phục vụ index.html. Không cần cài thư viện.
const http=require('http'),fs=require('fs'),path=require('path');
const KEY=process.env.GEMINI_API_KEY,MODEL=process.env.GEMINI_MODEL||'gemini-flash-latest',PORT=process.env.PORT||3000;
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
`+(b.focus?`Cấu trúc đang luyện: ${b.focus}. Thêm trường "grammar" nhận xét người học dùng cấu trúc này đúng/sai mấy lần. `:'')+`Trả về JSON: {"score":số 0-100,"good":"điểm tốt","fixes":[{"said":"câu người học","better":"câu sửa tiếng Trung","why":"giải thích ngắn tiếng Việt"}],"tip":"lời khuyên"}`};
const MODELS=[MODEL,...(process.env.GEMINI_FALLBACK||'gemini-flash-lite-latest').split(',').map(x=>x.trim()).filter(x=>x&&x!==MODEL)];
const CHAT_MODEL=process.env.GEMINI_CHAT_MODEL||'gemini-flash-lite-latest';
const CHATM=[CHAT_MODEL,...MODELS.filter(m=>m!==CHAT_MODEL)];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function gem(prompt,models=MODELS){
 let last='',t0=Date.now(),think=true,quota=false;
 for(const model of models){
  for(let t=0;t<3;t++){
   if(Date.now()-t0>55000)throw new Error('Gemini phản hồi quá lâu, thử lại sau ít phút. '+last.slice(0,120));
   const cfg={responseMimeType:'application/json',temperature:0.8};if(think)cfg.thinkingConfig={thinkingBudget:0};
   let r;try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json','x-goog-api-key':KEY},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:cfg})})}
   catch(e){last=`Model ${model} không phản hồi kịp (25 giây).`;break}
   if(r.ok){const j=await r.json();const x=(j.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
    try{return JSON.parse(x.replace(/```json|```/g,'').trim())}catch{last='AI trả về dữ liệu lỗi, thử lại.';continue}}
   let m='';try{m=(await r.json()).error?.message||''}catch{}
   last=`Gemini lỗi ${r.status} (model: ${model}): ${m}`.slice(0,300);
   if(r.status===400&&think){think=false;t--;continue}   // model không nhận tùy chọn tắt suy nghĩ → thử lại không có
   if(r.status===404)break;
   if(r.status===429){if(t<1){await sleep(2500);continue}quota=true;break}
   if(r.status>=500){await sleep(1000*(t+1));continue}
   throw new Error(last);
  }
 }
 if(quota)throw Object.assign(new Error('Hết lượt miễn phí tạm thời, thử lại sau ít phút.'),{code:429});
 throw new Error(/50\d|kịp/.test(last)?'Gemini đang quá tải hoặc chậm, thử lại sau ít phút. ('+last.slice(0,120)+')':last);
}
async function gemStream(prompt,res){
 let last='',quota=false;
 for(const model of CHATM){let think=true;
  for(let t=0;t<2;t++){
   const cfg={temperature:0.8,maxOutputTokens:300};if(think)cfg.thinkingConfig={thinkingBudget:0};
   let r;try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,{method:'POST',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','x-goog-api-key':KEY},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:cfg})})}
   catch{last=`Model ${model} không phản hồi kịp.`;break}
   if(!r.ok){let m='';try{m=(await r.json()).error?.message||''}catch{}
    last=`Gemini lỗi ${r.status} (model: ${model}): ${m}`.slice(0,300);
    if(r.status===400&&think){think=false;t--;continue}
    if(r.status===429){quota=true;break}
    if(r.status===404||r.status>=500)break;
    throw new Error(last)}
   res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
   const dec=new TextDecoder();let buf='';
   try{for await(const ch of r.body){buf+=dec.decode(ch,{stream:true});let i;
    while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line.startsWith('data:'))continue;
     try{const j=JSON.parse(line.slice(5));const x=(j.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');if(x)res.write(x)}catch{}}}}catch{}
   res.end();return}}
 if(quota)throw Object.assign(new Error('Hết lượt miễn phí tạm thời, thử lại sau ít phút.'),{code:429});
 throw new Error(last||'Gemini không phản hồi, thử lại.')}
http.createServer((req,res)=>{
 if(req.method==='POST'&&(req.url==='/api/ai'||req.url==='/api/stream')){
  let body='',big=false;req.on('data',c=>{if(big)return;body+=c;if(body.length>20000){big=true;res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Yêu cầu quá dài'}))}});
  req.on('end',async()=>{if(big)return;const send=(c,o)=>{if(res.headersSent)return res.end();res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
   try{if(!KEY)return send(500,{error:'Thiếu biến GEMINI_API_KEY trên Render.'});
    const b=JSON.parse(body||'{}');if(!P[b.task])return send(400,{error:'Yêu cầu không hợp lệ'});
    b.question=String(b.question||'').slice(0,500);b.line=String(b.line||'').slice(0,200);b.context=String(b.context||'').slice(0,400);b.lines=(Array.isArray(b.lines)?b.lines:[]).slice(0,40).map(x=>String(x).slice(0,120));b.qa=(Array.isArray(b.qa)?b.qa:[]).slice(-6).map(x=>({q:String(x.q||'').slice(0,300),a:String(x.a||'').slice(0,400)}));b.grammar=String(b.grammar||'').slice(0,300);b.focus=String(b.focus||'').slice(0,300);b.level=Math.min(9,Math.max(1,+b.level||2));b.desc=String(b.desc||'').slice(0,1500);
    b.partner=String(b.partner||'').slice(0,100);b.zh=String(b.zh||'').slice(0,300);
    b.history=(Array.isArray(b.history)?b.history:[]).slice(-30).map(x=>({role:x&&x.role==='me'?'me':'npc',zh:String((x&&x.zh)||'').slice(0,300)}));
    if(req.url==='/api/stream'){if(b.task!=='chat')return send(400,{error:'Yêu cầu không hợp lệ'});return await gemStream(P.chat(b),res)}
    const out=await gem(P[b.task](b),b.task==='notes'?CHATM:MODELS);
    if(b.task==='scenario'&&(!Array.isArray(out.dialogue)||out.dialogue.length<2||out.dialogue.some(d=>!d||!d.zh)))throw new Error('AI tạo bài chưa đúng định dạng, thử lại.');
    send(200,out);
   }catch(e){send(Number.isInteger(e.code)?e.code:500,{error:e.message||'Lỗi máy chủ'})}});
  return;}
 if(req.url==='/api/health'){res.end('ok');return}
 if(req.url==='/api/models'){(async()=>{try{const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',{headers:{'x-goog-api-key':KEY||''}});const j=await r.json();res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(r.ok?{current:MODEL,usable:(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace('models/',''))}:j,null,1))}catch(e){res.end(String(e))}})();return}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(__dirname,'index.html')));
}).listen(PORT,()=>console.log('http://localhost:'+PORT));

// Máy chủ nhỏ: giữ API key bí mật, gọi Gemini, phục vụ index.html. Không cần cài thư viện.
const http=require('http'),fs=require('fs'),path=require('path');
const KEY=process.env.GEMINI_API_KEY,MODEL=process.env.GEMINI_MODEL||'gemini-flash-latest',PORT=process.env.PORT||3000;
const lv=n=>`Trình độ HSK${n}: chỉ dùng từ vựng và ngữ pháp trong phạm vi HSK${n} (HSK1-2: câu rất ngắn 4-10 chữ; HSK3-4: vừa; HSK5-6: tự nhiên, phong phú). Chữ giản thể.`;
const P={
scenario:b=>`Tạo tình huống luyện nói tiếng Trung. Mô tả của người học: "${b.desc}". ${lv(b.level)}
Trả về JSON: {"emoji":"1 emoji","title":"tiêu đề tiếng Trung ngắn","titleVi":"nghĩa tiếng Việt","context":"bối cảnh tiếng Trung 2-3 câu","contextVi":"bản dịch tiếng Việt","partner":"tên và vai của nhân vật, ví dụ 小明 · 中国大学生","goals":["3 mục tiêu ngắn bằng tiếng Trung"],"dialogue":[{"role":"npc","zh":"","pinyin":"","vi":""}]}
dialogue gồm 8 lượt xen kẽ, bắt đầu bằng "npc", role chỉ là "npc" hoặc "me" (me là người học), kết thúc bằng "npc".`,
chat:b=>`Bạn đóng vai ${b.partner} trong tình huống: ${b.context}. Trò chuyện tự nhiên bằng tiếng Trung với người học. ${lv(b.level)} Mỗi lần chỉ nói 1-2 câu ngắn và hỏi tiếp để duy trì hội thoại. Người học nói sai thì vẫn đáp tự nhiên.
Lịch sử (role "me" là người học): ${JSON.stringify(b.history)}
${b.history.length?'Hãy đáp lại lượt cuối của người học.':'Hãy mở đầu cuộc trò chuyện.'}
Trả về JSON: {"zh":"","pinyin":"","vi":"bản dịch tiếng Việt","suggestions":["3 câu người học có thể đáp, tiếng Trung, đúng trình độ"]}`,
feedback:b=>`Nhận xét bằng tiếng Việt buổi hội thoại tiếng Trung sau của người học (${lv(b.level)}): ${JSON.stringify(b.history)}
Trả về JSON: {"score":số 0-100,"good":"điểm tốt","fixes":[{"said":"câu người học","better":"câu sửa tiếng Trung","why":"giải thích ngắn tiếng Việt"}],"tip":"lời khuyên"}`};
const MODELS=[MODEL,...(process.env.GEMINI_FALLBACK||'gemini-flash-lite-latest').split(',').map(x=>x.trim()).filter(x=>x&&x!==MODEL)];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function gem(prompt){
 let last='',t0=Date.now(),think=true;
 for(const model of MODELS){
  for(let t=0;t<3;t++){
   if(Date.now()-t0>55000)throw new Error('Gemini phản hồi quá lâu, thử lại sau ít phút. '+last.slice(0,120));
   const cfg={responseMimeType:'application/json',temperature:0.8};if(think)cfg.thinkingConfig={thinkingBudget:0};
   let r;try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json','x-goog-api-key':KEY},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:cfg})})}
   catch(e){last=`Model ${model} không phản hồi kịp (25 giây).`;break}
   if(r.ok){const j=await r.json();const x=(j.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
    try{return JSON.parse(x.replace(/```json|```/g,'').trim())}catch{last='AI trả về dữ liệu lỗi, thử lại.';continue}}
   let m='';try{m=(await r.json()).error?.message||''}catch{}
   last=`Gemini lỗi ${r.status} (model: ${model}): ${m}`.slice(0,300);
   if(r.status===400&&think&&/think/i.test(m)){think=false;t--;continue}   // model không hỗ trợ tắt suy nghĩ
   if(r.status===404)break;
   if(r.status===429){if(t<1){await sleep(2500);continue}throw Object.assign(new Error('Hết lượt miễn phí tạm thời, thử lại sau ít phút.'),{code:429})}
   if(r.status>=500){await sleep(1000*(t+1));continue}
   throw new Error(last);
  }
 }
 throw new Error(/50\d|kịp/.test(last)?'Gemini đang quá tải hoặc chậm, thử lại sau ít phút. ('+last.slice(0,120)+')':last);
}
http.createServer((req,res)=>{
 if(req.method==='POST'&&req.url==='/api/ai'){
  let body='';req.on('data',c=>{body+=c;if(body.length>20000)req.destroy()});
  req.on('end',async()=>{const send=(c,o)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
   try{if(!KEY)return send(500,{error:'Thiếu biến GEMINI_API_KEY trên Render.'});
    const b=JSON.parse(body||'{}');if(!P[b.task])return send(400,{error:'Yêu cầu không hợp lệ'});
    b.level=Math.min(6,Math.max(1,+b.level||2));b.desc=String(b.desc||'').slice(0,1500);b.history=(b.history||[]).slice(-30);
    send(200,await gem(P[b.task](b)));
   }catch(e){send(e.code||500,{error:e.message||'Lỗi máy chủ'})}});
  return;}
 if(req.url==='/api/health'){res.end('ok');return}
 if(req.url==='/api/models'){(async()=>{try{const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',{headers:{'x-goog-api-key':KEY||''}});const j=await r.json();res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(r.ok?{current:MODEL,usable:(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace('models/',''))}:j,null,1))}catch(e){res.end(String(e))}})();return}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'index.html')));
}).listen(PORT,()=>console.log('http://localhost:'+PORT));

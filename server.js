// Máy chủ nhỏ: giữ API key bí mật, gọi Gemini, phục vụ index.html. Không cần cài thư viện.
const http=require('http'),fs=require('fs'),path=require('path');
// Đọc khóa từ biến môi trường, hoặc từ Secret File của Render (/etc/secrets/TÊN hoặc ./TÊN)
const sec=n=>{let v=process.env[n]||'';if(!v)for(const p of ['/etc/secrets/'+n,path.join(__dirname,n)]){try{v=fs.readFileSync(p,'utf8');if(v)break}catch{}}return v.trim().replace(/^["']+|["']+$/g,'')};
let ki=0;const KEYS=[...new Set([sec('GEMINI_API_KEYS'),sec('GEMINI_API_KEY')].join(',').split(/[\s,;]+/).filter(Boolean))],KEY=KEYS[0]||'',MODEL=process.env.GEMINI_MODEL||'gemini-flash-latest',PORT=process.env.PORT||3000;
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
Yêu cầu: rất ngắn gọn. "good" và "tip" mỗi cái 1 câu; "fixes" tối đa 3 lỗi quan trọng nhất, "why" dưới 20 chữ; chỉ xét các lượt của người học (role "me"), bỏ qua lời nhân vật.`,
picfb:b=>`Người học tiếng Trung (${lv(b.level)}) nhìn bức ảnh đính kèm (chủ đề tìm ảnh: "${b.topic}") và miêu tả bằng tiếng Trung: "${b.text}"
Hãy xem kỹ ảnh rồi nhận xét bằng tiếng Việt: miêu tả có đúng với ảnh không, ngữ pháp, từ vựng. Nếu người học không viết tiếng Trung thì nhắc họ miêu tả bằng tiếng Trung (điểm thấp).
Trả về JSON: {"score":số 0-100,"good":"điểm tốt, 1 câu","fixes":[{"said":"câu người học","better":"câu sửa tiếng Trung","why":"giải thích ngắn tiếng Việt"}],"missed":["2-3 chi tiết đáng nói trong ảnh mà người học chưa nhắc, tiếng Việt"],"model":{"zh":"bài miêu tả mẫu 2-4 câu tiếng Trung đúng trình độ","pinyin":"pinyin","vi":"bản dịch"},"words":[{"zh":"","pinyin":"","vi":""}]}
Yêu cầu: rất ngắn gọn; "fixes" tối đa 3, "why" dưới 20 chữ; "words" 3-4 từ vựng hữu ích để miêu tả ảnh này, đúng trình độ.`,
words:b=>`Chọn ngẫu nhiên 5 từ tiếng Trung để người học (${lv(b.level)}) luyện đặt câu`+(b.desc?`, theo chủ đề "${b.desc}"`:`, gợi ý chủ đề ngẫu nhiên: ${b.seed}`)+`. 5 từ nên khác loại (danh từ, động từ, tính từ, trạng từ hoặc liên từ...) nhưng có thể ghép chung vào 1-3 câu hợp lý. Chỉ chọn từ đơn hoặc cụm cố định liền nhau, không chọn cấu trúc ngắt quãng như 一边…一边. Tránh các từ đã ra: ${JSON.stringify(b.prev)}.
Trả về JSON: {"words":[{"zh":"","pinyin":"","vi":""}]} đúng 5 phần tử.`,
wordscheck:b=>`Người học tiếng Trung (${lv(b.level)}) được giao 5 từ và phải đặt MỖI TỪ MỘT CÂU. Danh sách (theo thứ tự): ${JSON.stringify(b.words.map((w,k)=>({word:w,sentence:b.sentences[k]||''})))}
Nhận xét bằng tiếng Việt. Câu để trống hoặc không chứa từ được giao thì ok=false.
Trả về JSON: {"score":số 0-100,"items":[{"word":"từ được giao","ok":true,"better":"câu đúng tiếng Trung (giữ câu của người học nếu đã đúng; nếu sai hoặc trống thì viết câu sửa/câu mẫu dùng từ đó)","pinyin":"pinyin của better","vi":"dịch better","why":"giải thích ngắn tiếng Việt, rỗng nếu đúng"}],"tip":"lời khuyên 1 câu"}
Yêu cầu: rất ngắn gọn; "items" đúng 5 phần tử theo thứ tự từ được giao; "why" dưới 20 chữ; câu mẫu đúng trình độ.`};
const THEMES=['ăn uống','du lịch','công việc','trường học','mua sắm','gia đình','sức khỏe','thời tiết','thể thao','công nghệ','sở thích','giao thông','nhà cửa','bạn bè','lễ hội'];
const MODELS=[MODEL,...(process.env.GEMINI_FALLBACK||'gemini-flash-lite-latest').split(',').map(x=>x.trim()).filter(x=>x&&x!==MODEL)];
const CHAT_MODEL=process.env.GEMINI_CHAT_MODEL||'gemini-flash-lite-latest';
const FB=process.env.GEMINI_FEEDBACK_MODEL||CHAT_MODEL;
const FBM=[FB,...MODELS.filter(m=>m!==FB)];
const CHATM=[CHAT_MODEL,...MODELS.filter(m=>m!==CHAT_MODEL)];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function gem(prompt,models=MODELS,maxTok=0,extra=[]){
 let last='',t0=Date.now(),think=true,quota=false;ki=(ki+1)%Math.max(KEYS.length,1);
 for(const model of models){let rot=0;
  for(let t=0;t<3;t++){
   if(Date.now()-t0>55000)throw new Error('Gemini phản hồi quá lâu, thử lại sau ít phút. '+last.slice(0,120));
   const cfg={responseMimeType:'application/json',temperature:0.8};if(maxTok)cfg.maxOutputTokens=maxTok;if(think)cfg.thinkingConfig={thinkingBudget:0};
   let r;try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json','x-goog-api-key':KEYS[ki]},body:JSON.stringify({contents:[{parts:[...extra,{text:prompt}]}],generationConfig:cfg})})}
   catch(e){last=`Model ${model} không phản hồi kịp (25 giây).`;break}
   if(r.ok){const j=await r.json();const x=(j.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
    try{return JSON.parse(x.replace(/```json|```/g,'').trim())}catch{last='AI trả về dữ liệu lỗi, thử lại.';continue}}
   let m='';try{m=(await r.json()).error?.message||''}catch{}
   last=`Gemini lỗi ${r.status} (model: ${model}): ${m}`.slice(0,300);
   if(KEYS.length>1&&(r.status===429||r.status===403||(r.status===400&&/API key/i.test(m)))&&rot<KEYS.length-1){rot++;ki=(ki+1)%KEYS.length;t--;continue}
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
 let last='',quota=false;ki=(ki+1)%Math.max(KEYS.length,1);
 for(const model of CHATM){let think=true,rot=0;
  for(let t=0;t<2;t++){
   const cfg={temperature:0.8,maxOutputTokens:300};if(think)cfg.thinkingConfig={thinkingBudget:0};
   let r;try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,{method:'POST',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','x-goog-api-key':KEYS[ki]},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:cfg})})}
   catch{last=`Model ${model} không phản hồi kịp.`;break}
   if(!r.ok){let m='';try{m=(await r.json()).error?.message||''}catch{}
    last=`Gemini lỗi ${r.status} (model: ${model}): ${m}`.slice(0,300);
    if(KEYS.length>1&&(r.status===429||r.status===403||(r.status===400&&/API key/i.test(m)))&&rot<KEYS.length-1){rot++;ki=(ki+1)%KEYS.length;t--;continue}
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
const UA='hsk-speaking/1.0 (language learning app)',PEXELS=sec('PEXELS_API_KEY'),PIXABAY=sec('PIXABAY_API_KEY').replace(/^key=/i,''),IMG_HOSTS=['images.pexels.com','upload.wikimedia.org','pixabay.com','cdn.pixabay.com'],qCache=new Map();
async function imgQuery(q){
 if(/^[\x20-\x7e]+$/.test(q))return q;
 if(qCache.has(q))return qCache.get(q);
 try{const o=await gem(`Dịch chủ đề ảnh sau sang từ khóa tìm ảnh tiếng Anh ngắn (1-4 từ, cụ thể, dễ ra ảnh đời thường): "${q}". Trả về JSON: {"q":"..."}`,CHATM,100);const e=String(o.q||'').slice(0,80);if(e){qCache.set(q,e);return e}}catch{}
 return q}
async function findImage(q,seen){
 const eq=await imgQuery(q);let list=[];
 let note='';
 if(PIXABAY){try{
  const r=await fetch('https://pixabay.com/api/?key='+encodeURIComponent(PIXABAY)+'&image_type=photo&orientation=horizontal&safesearch=true&per_page=50&q='+encodeURIComponent(eq.slice(0,100)),{signal:AbortSignal.timeout(15000)});
  const t=await r.text();
  if(!r.ok){note='Pixabay '+r.status+': '+t.slice(0,160);console.log(note)}
  else{const j=JSON.parse(t);list=(j.hits||[]).filter(p=>p.webformatURL).map(p=>({id:'x'+p.id,url:p.webformatURL,credit:p.user+' / Pixabay',link:p.pageURL}))}
 }catch(e){note='Pixabay: '+e.message;console.log(note)}}
 if(!list.length&&PEXELS){try{
  const r=await fetch('https://api.pexels.com/v1/search?per_page=30&orientation=landscape&query='+encodeURIComponent(eq),{headers:{Authorization:PEXELS},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('Tìm ảnh lỗi (Pexels '+r.status+').');
  const j=await r.json();list=(j.photos||[]).map(p=>({id:'p'+p.id,url:p.src.large,credit:p.photographer+' / Pexels',link:p.url}));
 }catch(e){note+=' Pexels: '+e.message}}
 if(!list.length){
  const r=await fetch('https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=30&prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=800&gsrsearch='+encodeURIComponent(eq+' filetype:bitmap'),{headers:{'User-Agent':UA},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('Tìm ảnh lỗi (Wikimedia '+r.status+').');
  const j=await r.json();
  list=Object.values(j.query?.pages||{}).map(p=>({p,i:p.imageinfo?.[0]})).filter(x=>x.i&&x.i.mime==='image/jpeg'&&x.i.thumburl).map(x=>({id:'w'+x.p.pageid,url:x.i.thumburl,credit:'Wikimedia Commons',link:x.i.descriptionurl}));
 }
 const fresh=list.filter(x=>!seen.includes(x.id)),pool=fresh.length?fresh:list;
 if(!pool.length)throw Object.assign(new Error('Không tìm thấy ảnh cho chủ đề này, thử từ khóa khác.'+(note?' ['+note.trim()+']':'')),{code:404});
 return{...pool[Math.floor(Math.random()*pool.length)],q:eq}}
async function fetchImg(u){
 let url;try{url=new URL(u)}catch{throw new Error('Địa chỉ ảnh không hợp lệ.')}
 if(url.protocol!=='https:'||!IMG_HOSTS.includes(url.hostname))throw new Error('Địa chỉ ảnh không hợp lệ.');
 let r;try{r=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':UA}})}catch{throw new Error('Không tải được ảnh để chấm, thử lại.')}
 const ct=(r.headers.get('content-type')||'').split(';')[0];
 if(!r.ok||!/^image\/(jpeg|png|webp)$/.test(ct))throw new Error('Không tải được ảnh để chấm, thử lại.');
 const buf=Buffer.from(await r.arrayBuffer());if(buf.length>4e6)throw new Error('Ảnh quá lớn.');
 return{inlineData:{mimeType:ct,data:buf.toString('base64')}}}
http.createServer((req,res)=>{
 if(req.method==='POST'&&(req.url==='/api/ai'||req.url==='/api/stream')){
  let body='',big=false;req.on('data',c=>{if(big)return;body+=c;if(body.length>20000){big=true;res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Yêu cầu quá dài'}))}});
  req.on('end',async()=>{if(big)return;const send=(c,o)=>{if(res.headersSent)return res.end();res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
   try{if(!KEY)return send(500,{error:'Thiếu biến GEMINI_API_KEY trên Render.'});
    const b=JSON.parse(body||'{}');if(!P[b.task])return send(400,{error:'Yêu cầu không hợp lệ'});
    b.question=String(b.question||'').slice(0,500);b.line=String(b.line||'').slice(0,200);b.context=String(b.context||'').slice(0,400);b.lines=(Array.isArray(b.lines)?b.lines:[]).slice(0,40).map(x=>String(x).slice(0,120));b.qa=(Array.isArray(b.qa)?b.qa:[]).slice(-6).map(x=>({q:String(x.q||'').slice(0,300),a:String(x.a||'').slice(0,400)}));b.grammar=String(b.grammar||'').slice(0,300);b.focus=String(b.focus||'').slice(0,300);b.level=Math.min(9,Math.max(1,+b.level||2));b.desc=String(b.desc||'').slice(0,1500);
    b.partner=String(b.partner||'').slice(0,100);b.zh=String(b.zh||'').slice(0,300);
    b.topic=String(b.topic||'').slice(0,100);b.text=String(b.text||'').slice(0,600);b.img=String(b.img||'').slice(0,600);b.words=(Array.isArray(b.words)?b.words:[]).slice(0,5).map(x=>String(x).slice(0,20));b.prev=(Array.isArray(b.prev)?b.prev:[]).slice(-30).map(x=>String(x).slice(0,20));b.sentences=(Array.isArray(b.sentences)?b.sentences:[]).slice(0,5).map(x=>String(x||'').slice(0,200));while(b.sentences.length<5)b.sentences.push('');b.seed=THEMES[Math.floor(Math.random()*THEMES.length)];
    b.history=(Array.isArray(b.history)?b.history:[]).slice(-30).map(x=>({role:x&&x.role==='me'?'me':'npc',zh:String((x&&x.zh)||'').slice(0,300)}));
    if(req.url==='/api/stream'){if(b.task!=='chat')return send(400,{error:'Yêu cầu không hợp lệ'});return await gemStream(P.chat(b),res)}
    const T=b.task;
    if(T==='picfb'&&!b.text.trim())return send(400,{error:'Hãy miêu tả bức tranh trước.'});
    if(T==='wordscheck'&&(b.words.length<5||!b.sentences.some(x=>x.trim())))return send(400,{error:'Hãy đặt ít nhất một câu.'});
    const imgs=T==='picfb'?[await fetchImg(b.img)]:[];
    const out=await gem(P[T](b),T==='notes'||T==='words'?CHATM:T==='feedback'||T==='picfb'||T==='wordscheck'?FBM:MODELS,{feedback:1000,picfb:1400,wordscheck:1000,words:400}[T]||0,imgs);
    if(T==='words'){if(!Array.isArray(out.words)||out.words.length<5||out.words.some(w=>!w||!w.zh))throw new Error('AI chọn từ chưa đúng định dạng, thử lại.');out.words=out.words.slice(0,5)}
    if(b.task==='scenario'&&(!Array.isArray(out.dialogue)||out.dialogue.length<2||out.dialogue.some(d=>!d||!d.zh)))throw new Error('AI tạo bài chưa đúng định dạng, thử lại.');
    send(200,out);
   }catch(e){send(Number.isInteger(e.code)?e.code:500,{error:e.message||'Lỗi máy chủ'})}});
  return;}
 if(req.method==='GET'&&req.url.startsWith('/api/image')){(async()=>{
  const out=(c,o)=>{res.writeHead(c,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(o))};
  try{const u=new URL(req.url,'http://x'),q=(u.searchParams.get('q')||'').trim().slice(0,60),seen=(u.searchParams.get('seen')||'').split(',').slice(0,40);
   if(!q)return out(400,{error:'Nhập chủ đề trước nhé.'});
   out(200,await findImage(q,seen))}
  catch(e){out([400,404,429].includes(e.code)?e.code:500,{error:e.message||'Lỗi tìm ảnh'})}})();return}
 if(req.url==='/api/health'){res.end('ok');return}
 if(req.url==='/api/models'){(async()=>{try{const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',{headers:{'x-goog-api-key':KEYS[ki]||''}});const j=await r.json();res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(r.ok?{current:MODEL,usable:(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace('models/',''))}:j,null,1))}catch(e){res.end(String(e))}})();return}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(__dirname,'index.html')));
}).listen(PORT,()=>console.log('http://localhost:'+PORT));

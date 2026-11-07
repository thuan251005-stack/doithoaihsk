// Máy chủ nhỏ: giữ API key bí mật, gọi Gemini, phục vụ index.html. Không cần cài thư viện.
const http=require('http'),fs=require('fs'),path=require('path');
// Đọc khóa từ biến môi trường hoặc Secret File của Render (/etc/secrets/TÊN hoặc ./TÊN)
const sec=n=>{let v=process.env[n]||'';if(!v)for(const p of ['/etc/secrets/'+n,path.join(__dirname,n)]){try{v=fs.readFileSync(p,'utf8');if(v)break}catch{}}return v.trim().replace(/^["']+|["']+$/g,'')};
// Xoay vòng nhiều khóa Gemini: GEMINI_API_KEYS=khoa1,khoa2,khoa3 (hoặc một khóa trong GEMINI_API_KEY)
let ki=0;const KEYS=[...new Set([sec('GEMINI_API_KEYS'),sec('GEMINI_API_KEY')].join(',').split(/[\s,;|]+/).filter(Boolean))],KEY=KEYS[0]||'',MODEL=process.env.GEMINI_MODEL||'gemini-flash-latest',PORT=process.env.PORT||3000;
const lv=n=>`Trình độ HSK 3.0 bậc ${n} (hệ 9 bậc theo Tiêu chuẩn trình độ tiếng Trung giáo dục quốc tế 2021; bậc 1-3 sơ cấp, 4-6 trung cấp, 7-9 cao cấp): chỉ dùng từ vựng và ngữ pháp trong phạm vi bậc ${n} (bậc 1-2: câu rất ngắn 4-10 chữ; bậc 3-4: độ dài vừa; bậc 5+: tự nhiên, phong phú). Chữ giản thể.`;
const ERR='Mỗi lỗi có "type" là một trong: "Ngữ pháp", "Từ vựng", "Sai chữ", "Nội dung". Chỉ nêu lỗi thật sự (không bịa, không bắt lỗi dấu câu hay viết hoa); câu đúng thì không đưa vào. Lời người học có thể đến từ nhận diện giọng nói nên bỏ qua dấu câu; chữ đồng âm sai nhỏ thì ghi "Sai chữ".';
const ERRJ='{"type":"Ngữ pháp|Từ vựng|Sai chữ|Nội dung","said":"đoạn người học nói hoặc viết sai","better":"cách sửa bằng tiếng Trung","why":"giải thích tiếng Việt dưới 20 chữ"}';
const BRK='"breakdown":{"grammar":số 0-100,"vocab":số 0-100,"content":số 0-100}';
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
`+(b.focus?`Cấu trúc đang luyện: ${b.focus}. Thêm trường "grammar" nhận xét người học dùng cấu trúc này đúng/sai mấy lần. `:'')+`${ERR}
Trả về JSON: {"score":số 0-100,${BRK},"good":"điểm tốt, 1 câu","errors":[${ERRJ}],"tip":"lời khuyên, 1 câu"}
Yêu cầu: rất ngắn gọn; "errors" tối đa 6 lỗi quan trọng nhất; chỉ xét các lượt của người học (role "me"), bỏ qua lời nhân vật; "content" đánh giá người học có đáp đúng ý câu của nhân vật không.`,
picfb:b=>`Người học tiếng Trung (${lv(b.level)}) nhìn bức ảnh đính kèm và miêu tả bằng tiếng Trung: "${b.text}"
Hãy xem kỹ ảnh rồi chấm bằng tiếng Việt: (1) miêu tả có đúng nội dung ảnh không, (2) lỗi ngữ pháp, (3) lỗi từ vựng (dùng sai từ hoặc không hợp trình độ), (4) lỗi chữ. Nếu người học không viết tiếng Trung thì nhắc họ miêu tả bằng tiếng Trung (điểm thấp). ${ERR}
Trả về JSON: {"seen":"1-2 câu tiếng Việt: bạn thấy gì trong ảnh","score":số 0-100,${BRK},"good":"điểm tốt, 1 câu","errors":[${ERRJ}],"missed":["2-3 chi tiết đáng nói trong ảnh mà người học chưa nhắc, tiếng Việt"],"model":{"zh":"bài miêu tả mẫu 2-4 câu tiếng Trung đúng trình độ","pinyin":"pinyin","vi":"bản dịch"},"words":[{"zh":"","pinyin":"","vi":""}]}
Yêu cầu: rất ngắn gọn; "errors" tối đa 6 lỗi quan trọng nhất; "content" đánh giá độ đúng với ảnh; "words" 3-4 từ vựng hữu ích để miêu tả ảnh này, đúng trình độ.`,
words:b=>`Chọn ngẫu nhiên 5 từ tiếng Trung để người học (${lv(b.level)}) luyện đặt câu`+(b.desc?`, theo chủ đề "${b.desc}"`:`, gợi ý chủ đề ngẫu nhiên: ${b.seed}`)+`. 5 từ nên khác loại (danh từ, động từ, tính từ, trạng từ hoặc liên từ...) nhưng có thể ghép chung vào 1-3 câu hợp lý. Chỉ chọn từ đơn hoặc cụm cố định liền nhau, không chọn cấu trúc ngắt quãng như 一边…一边. Tránh các từ đã ra: ${JSON.stringify(b.prev)}.
Trả về JSON: {"words":[{"zh":"","pinyin":"","vi":""}]} đúng 5 phần tử.`,
wordscheck:b=>`Người học tiếng Trung (${lv(b.level)}) được giao 5 từ và phải đặt MỖI TỪ MỘT CÂU. Danh sách (theo thứ tự): ${JSON.stringify(b.words.map((w,k)=>({word:w,sentence:b.sentences[k]||''})))}
Nhận xét bằng tiếng Việt. Câu để trống hoặc không chứa từ được giao thì ok=false. ${ERR}
Trả về JSON: {"score":số 0-100,${BRK},"items":[{"word":"từ được giao","ok":true,"type":"loại lỗi chính (Ngữ pháp, Từ vựng, Sai chữ, Nội dung hoặc Chưa đặt câu), để rỗng nếu đúng","better":"câu đúng tiếng Trung (giữ câu của người học nếu đã đúng; nếu sai hoặc trống thì viết câu sửa/câu mẫu dùng từ đó)","pinyin":"pinyin của better","vi":"dịch better","why":"giải thích ngắn tiếng Việt, rỗng nếu đúng"}],"tip":"lời khuyên 1 câu"}
Yêu cầu: rất ngắn gọn; "items" đúng 5 phần tử theo thứ tự từ được giao; "why" dưới 20 chữ; câu mẫu đúng trình độ.`,
testgen:b=>{const L=b.level,band=L<=2?'Phần 1 mode "repeat" (nghe rồi nhắc lại): đúng 4 câu, mỗi câu 4-8 chữ. Phần 2: đúng 3 câu hỏi rất đơn giản về chủ đề (trả lời 1 câu ngắn). Phần 3: đề nói về chủ đề, người học nói 2-3 câu.':L<=4?'Phần 1 mode "repeat" (nghe rồi nhắc lại): đúng 3 câu, mỗi câu 10-18 chữ. Phần 2: đúng 2 câu hỏi về trải nghiệm cá nhân (trả lời 1-2 câu). Phần 3: đề nói về chủ đề, người học nói 4-5 câu.':L<=6?'Phần 1 mode "read" (đọc to): đúng 1 đoạn văn 2-3 câu, khoảng 50-80 chữ, đọc trôi chảy. Phần 2: đúng 2 câu hỏi nêu ý kiến và lý do. Phần 3: đề nói về chủ đề, người học nói 6-8 câu có mở đầu, ý chính, kết.':'Phần 1 mode "read" (đọc to): đúng 1 đoạn văn khoảng 90-130 chữ, từ vựng trừu tượng, có thành ngữ hoặc câu dài. Phần 2: đúng 2 câu hỏi quan điểm mang tính trừu tượng, cần lập luận. Phần 3: đề nói trong khoảng 1 phút (8-10 câu), có lập luận và dẫn chứng.';
return `Soạn một bài KIỂM TRA NÓI tiếng Trung cho người học (${lv(L)}) với chủ đề: "${b.theme}". Mọi nội dung phải nằm trong phạm vi bậc ${L}. ${band}
Trả về JSON: {"topicZh":"tên chủ đề tiếng Trung ngắn","topicVi":"nghĩa tiếng Việt","part1":{"mode":"repeat hoặc read","items":[{"zh":"","pinyin":"","vi":""}]},"part2":[{"zh":"câu hỏi","pinyin":"","vi":""}],"part3":{"zh":"đề bài nói bằng tiếng Trung","vi":"dịch tiếng Việt","hints":["3 gợi ý ý nói, tiếng Trung rất ngắn"]}}
Các phần phải liên quan đến chủ đề nhưng không lặp ý nhau.`},
testcheck:b=>`Chấm bài KIỂM TRA NÓI tiếng Trung của người học (${lv(b.level)}), chủ đề "${b.topic}". Câu trả lời có thể đến từ nhận diện giọng nói.
Phần 2 (trả lời câu hỏi): ${JSON.stringify(b.ans)}
Phần 3 (nói theo đề): ${JSON.stringify(b.talk)}
Nhận xét bằng tiếng Việt. Câu để trống thì 0 điểm, không liệt kê lỗi. ${ERR}
Trả về JSON: {"p2":{"score":số 0-100,"items":[{"score":số 0-100,"errors":[${ERRJ}],"model":"câu trả lời mẫu tiếng Trung đúng trình độ","vi":"dịch câu mẫu"}]},"p3":{"score":số 0-100,"errors":[${ERRJ}],"model":{"zh":"bài nói mẫu rút gọn 3-5 câu, đúng trình độ","pinyin":"pinyin","vi":"bản dịch"}},${BRK},"tip":"lời khuyên 1-2 câu"}
Yêu cầu: rất ngắn gọn; "items" đúng ${b.ans.length} phần tử theo thứ tự; mỗi "errors" của phần 2 tối đa 3 lỗi, của phần 3 tối đa 5 lỗi; "breakdown" tổng hợp cả hai phần.`,
structgen:b=>`Người học tiếng Trung (${lv(b.level)}) muốn luyện đặt câu với cấu trúc ngữ pháp: "${b.focus}".
`+(b.note?`Giải thích cấu trúc (từ giáo trình của người học): ${b.note}\n`:'')+`Hãy đưa ra đúng 3 câu TIẾNG VIỆT, mỗi câu một ngữ cảnh đời thường khác nhau, để người học dịch sang tiếng Trung bằng ĐÚNG cấu trúc này. Câu tiếng Việt ngắn gọn, tự nhiên; từ vựng tiếng Trung tương ứng nằm trong phạm vi bậc ${b.level}; ý câu phải dịch tự nhiên được bằng cấu trúc đó (không ép gượng). Tránh các câu đã ra: ${JSON.stringify(b.prev)}.
Trả về JSON: {"items":[{"vi":"câu tiếng Việt cần dịch","hint":"1-3 từ tiếng Trung gợi ý kèm pinyin và nghĩa, ví dụ: 超市 (chāoshì: siêu thị); để rỗng nếu không cần"}]} đúng 3 phần tử.`,
structcheck:b=>`Người học tiếng Trung (${lv(b.level)}) luyện đặt câu với cấu trúc ngữ pháp: "${b.focus}".
`+(b.note?`Giải thích cấu trúc (từ giáo trình của người học): ${b.note}\n`:'')+`Mỗi bài gồm một câu tiếng Việt và câu tiếng Trung người học viết: ${JSON.stringify(b.ans.map(x=>({viet:x.q,zh:x.a})))}
Nhận xét bằng tiếng Việt. Với mỗi câu kiểm tra: (1) có dùng ĐÚNG cấu trúc yêu cầu không ("used"), (2) lỗi ngữ pháp, (3) lỗi từ vựng hoặc dùng sai từ, (4) nghĩa có khớp câu tiếng Việt không. Câu để trống: used=false, score 0, không liệt kê lỗi. ${ERR}
Trả về JSON: {"score":số 0-100,${BRK},"items":[{"used":true,"score":số 0-100,"errors":[${ERRJ}],"better":"câu mẫu đúng, dùng đúng cấu trúc (giữ câu của người học nếu đã đúng)","pinyin":"pinyin của better","vi":"dịch better"}],"tip":"lời khuyên 1 câu"}
Yêu cầu: rất ngắn gọn; "items" đúng ${b.ans.length} phần tử theo thứ tự; mỗi câu tối đa 3 lỗi; nếu người học không dùng cấu trúc yêu cầu thì thêm một lỗi type "Ngữ pháp" nói rõ thiếu cấu trúc nào; câu mẫu đúng trình độ.`
};
const THEMES=['ăn uống','du lịch','công việc','trường học','mua sắm','gia đình','sức khỏe','thời tiết','thể thao','công nghệ','sở thích','giao thông','nhà cửa','bạn bè','lễ hội'];
const TH_LOW=[...THEMES,'bữa sáng','đi khám bệnh','hỏi đường','thuê nhà','gọi điện thoại','sinh nhật','mua quần áo','đi xe buýt','nuôi thú cưng','cuối tuần'];
const TH_MID=['học ngoại ngữ','làm việc nhóm','du lịch tự túc','ăn uống lành mạnh','mạng xã hội','mua sắm trực tuyến','văn hóa truyền thống','thành phố thay đổi','khởi nghiệp','hoạt động tình nguyện','tiết kiệm tiền','thói quen mỗi ngày'];
const TH_HI=['bảo vệ môi trường','giáo dục và tương lai','trí tuệ nhân tạo','toàn cầu hóa','già hóa dân số','áp lực công việc','di sản văn hóa','phát triển bền vững','tin giả trên mạng','cân bằng công việc','đô thị hóa','giao lưu văn hóa'];
const pickTheme=(L,prev)=>{const pool=(L<=3?TH_LOW:L<=6?[...TH_LOW,...TH_MID]:[...TH_MID,...TH_HI]),f=pool.filter(t=>!prev.includes(t.slice(0,20)));const a=f.length?f:pool;return a[Math.floor(Math.random()*a.length)]};
const MODELS=[MODEL,...(process.env.GEMINI_FALLBACK||'gemini-flash-lite-latest').split(',').map(x=>x.trim()).filter(x=>x&&x!==MODEL)];
const CHAT_MODEL=process.env.GEMINI_CHAT_MODEL||'gemini-flash-lite-latest';
const FB=process.env.GEMINI_FEEDBACK_MODEL||CHAT_MODEL;
const FBM=[FB,...MODELS.filter(m=>m!==FB)];
const CHATM=[CHAT_MODEL,...MODELS.filter(m=>m!==CHAT_MODEL)];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function gem(prompt,models=MODELS,maxTok=0,extra=[]){
 let last='',t0=Date.now(),think=true,quota=false;ki=(ki+1)%Math.max(KEYS.length,1);
 for(const model of models){think=true;let rot=0;
  for(let t=0;t<3;t++){
   if(Date.now()-t0>55000)throw new Error('Gemini phản hồi quá lâu, thử lại sau ít phút. '+last.slice(0,120));
   const cfg={responseMimeType:'application/json',temperature:0.8};if(maxTok)cfg.maxOutputTokens=maxTok;if(think)cfg.thinkingConfig={thinkingBudget:0};
   let r;try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json','x-goog-api-key':KEYS[ki]},body:JSON.stringify({contents:[{parts:[...extra,{text:prompt}]}],generationConfig:cfg})})}
   catch(e){last=`Model ${model} không phản hồi kịp (25 giây).`;break}
   if(r.ok){const j=await r.json();const x=(j.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
    try{return JSON.parse(x.replace(/```json|```/g,'').trim())}catch{last='AI trả về dữ liệu lỗi, thử lại.';continue}}
   let m='';try{m=(await r.json()).error?.message||''}catch{}
   last=`Gemini lỗi ${r.status} (model: ${model}): ${m}`.slice(0,300);
   if(KEYS.length>1&&(r.status===429||r.status===401||r.status===403||(r.status===400&&/API key/i.test(m)))&&rot<KEYS.length-1){rot++;ki=(ki+1)%KEYS.length;t--;continue}
   if(r.status===400&&think){think=false;t--;continue}   // model không nhận tùy chọn tắt suy nghĩ → thử lại không có
   if(r.status===404)break;
   if(r.status===429){if(t<1){await sleep(2500);continue}quota=true;break}
   if(r.status>=500){await sleep(1000*(t+1));continue}
   throw new Error(r.status===401||/API key not valid/i.test(m)?'Khóa Gemini không hợp lệ. Kiểm tra GEMINI_API_KEYS trên Render ('+KEYS.length+' khóa đang nhận).':last);
  }
 }
 if(quota)throw Object.assign(new Error('Hết lượt miễn phí tạm thời, thử lại sau ít phút.'),{code:429});
 throw new Error(/50\d|kịp/.test(last)?'Gemini đang quá tải hoặc chậm, thử lại sau ít phút. ('+last.slice(0,120)+')':last);
}
async function gemStream(prompt,res){
 let last='',quota=false;ki=(ki+1)%Math.max(KEYS.length,1);
 for(const model of CHATM){let think=true,rot=0;
  for(let t=0;t<2;t++){
   const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),30000);res.on('close',()=>ac.abort());const cfg={temperature:0.8,maxOutputTokens:300};if(think)cfg.thinkingConfig={thinkingBudget:0};
   let r;try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,{method:'POST',signal:ac.signal,headers:{'Content-Type':'application/json','x-goog-api-key':KEYS[ki]},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:cfg})})}
   catch{if(res.destroyed)return;last=`Model ${model} không phản hồi kịp.`;break}
   if(!r.ok){let m='';try{m=(await r.json()).error?.message||''}catch{}
    last=`Gemini lỗi ${r.status} (model: ${model}): ${m}`.slice(0,300);
    if(KEYS.length>1&&(r.status===429||r.status===401||r.status===403||(r.status===400&&/API key/i.test(m)))&&rot<KEYS.length-1){rot++;ki=(ki+1)%KEYS.length;t--;continue}
    if(r.status===400&&think){think=false;t--;continue}
    if(r.status===429){quota=true;break}
    if(r.status===404||r.status>=500)break;
    throw new Error(r.status===401||/API key not valid/i.test(m)?'Khóa Gemini không hợp lệ. Kiểm tra GEMINI_API_KEYS trên Render ('+KEYS.length+' khóa đang nhận).':last)}
   res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
   const dec=new TextDecoder();let buf='';
   try{for await(const ch of r.body){buf+=dec.decode(ch,{stream:true});let i;
    while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line.startsWith('data:'))continue;
     try{const j=JSON.parse(line.slice(5));const x=(j.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');if(x)res.write(x)}catch{}}}}catch{}
   clearTimeout(tm);res.end();return}}
 if(quota)throw Object.assign(new Error('Hết lượt miễn phí tạm thời, thử lại sau ít phút.'),{code:429});
 throw new Error(last||'Gemini không phản hồi, thử lại.')}
const HITS=new Map();setInterval(()=>{const n=Date.now();for(const[k,v]of HITS)if(n-v.t>60000)HITS.delete(k)},60000).unref();
function limited(req){const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim(),n=Date.now();let v=HITS.get(ip);if(!v||n-v.t>60000){v={t:n,c:0};HITS.set(ip,v)}return ++v.c>(+process.env.RATE_PER_MIN||40)}
let G={t:0,c:0};
const globalLimited=()=>{const n=Date.now();if(n-G.t>60000)G={t:n,c:0};return ++G.c>(+process.env.GLOBAL_PER_MIN||240)};
http.createServer((req,res)=>{
 if(req.method==='POST'&&(req.url==='/api/ai'||req.url==='/api/stream'||req.url==='/api/vision')){
  if(limited(req)||globalLimited()){res.writeHead(429,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Bạn thao tác hơi nhanh, đợi một chút rồi thử lại.'}))}
  const MAX=req.url==='/api/vision'?1.6e6:20000;
  req.setEncoding('utf8');let body='',big=false;req.on('data',c=>{if(big)return;body+=c;if(body.length>MAX){big=true;res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Yêu cầu quá dài'}))}});
  req.on('end',async()=>{if(big)return;const send=(c,o)=>{if(res.headersSent)return res.end();res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
   try{if(!KEY)return send(500,{error:'Thiếu biến GEMINI_API_KEY trên Render.'});
    let b;try{b=JSON.parse(body||'{}')}catch{return send(400,{error:'Dữ liệu gửi lên không hợp lệ'})}
    if(!b||typeof b!=='object'||!Object.prototype.hasOwnProperty.call(P,b.task))return send(400,{error:'Yêu cầu không hợp lệ'});
    if((req.url==='/api/vision')!==(b.task==='picfb'))return send(400,{error:'Yêu cầu không hợp lệ'});
    b.question=String(b.question||'').slice(0,500);b.line=String(b.line||'').slice(0,200);b.context=String(b.context||'').slice(0,400);b.lines=(Array.isArray(b.lines)?b.lines:[]).slice(0,40).map(x=>String(x).slice(0,120));b.qa=(Array.isArray(b.qa)?b.qa:[]).slice(-6).map(x=>({q:String((x&&x.q)||'').slice(0,300),a:String((x&&x.a)||'').slice(0,400)}));b.grammar=String(b.grammar||'').slice(0,300);b.focus=String(b.focus||'').slice(0,300);b.level=Math.min(9,Math.max(1,+b.level||2));b.desc=String(b.desc||'').slice(0,1500);
    b.partner=String(b.partner||'').slice(0,100);b.zh=String(b.zh||'').slice(0,300);
    b.topic=String(b.topic||'').slice(0,100);b.text=String(b.text||'').slice(0,600);b.words=(Array.isArray(b.words)?b.words:[]).slice(0,5).map(x=>String(x).slice(0,20));b.prev=(Array.isArray(b.prev)?b.prev:[]).slice(-30).map(x=>String(x).slice(0,20));b.sentences=(Array.isArray(b.sentences)?b.sentences:[]).slice(0,5).map(x=>String(x||'').slice(0,200));while(b.sentences.length<5)b.sentences.push('');b.seed=THEMES[Math.floor(Math.random()*THEMES.length)];
    b.ans=(Array.isArray(b.ans)?b.ans:[]).slice(0,4).map(x=>({q:String((x&&x.q)||'').slice(0,200),a:String((x&&x.a)||'').slice(0,500)}));b.talk={q:String((b.talk&&b.talk.q)||'').slice(0,300),a:String((b.talk&&b.talk.a)||'').slice(0,1200)};b.theme=pickTheme(b.level,b.prev);b.note=String(b.note||'').slice(0,1500);
    b.history=(Array.isArray(b.history)?b.history:[]).slice(-30).map(x=>({role:x&&x.role==='me'?'me':'npc',zh:String((x&&x.zh)||'').slice(0,300)}));
    if(req.url==='/api/stream'){if(b.task!=='chat')return send(400,{error:'Yêu cầu không hợp lệ'});return await gemStream(P.chat(b),res)}
    const T=b.task;
    if(T==='picfb'&&!b.text.trim())return send(400,{error:'Hãy miêu tả bức tranh trước.'});
    if(T==='wordscheck'&&(b.words.length<5||!b.sentences.some(x=>x.trim())))return send(400,{error:'Hãy đặt ít nhất một câu.'});
    if(T==='testcheck'&&!b.ans.some(x=>x.a.trim())&&!b.talk.a.trim())return send(400,{error:'Hãy trả lời ít nhất một phần.'});
    if(T==='structgen'&&!b.focus.trim())return send(400,{error:'Hãy chọn một cấu trúc trước.'});
    if(T==='structcheck'&&(!b.focus.trim()||!b.ans.some(x=>x.a.trim())))return send(400,{error:'Hãy đặt ít nhất một câu.'});
    let imgs=[];
    if(T==='picfb'){const m=String(b.imgMime||''),d=String(b.imgData||'');if(!/^image\/(jpeg|png|webp)$/.test(m)||d.length<100||d.length>1.5e6||!/^[A-Za-z0-9+/]+={0,2}$/.test(d))return send(400,{error:'Ảnh không hợp lệ hoặc quá lớn, hãy chọn ảnh khác.'});imgs=[{inlineData:{mimeType:m,data:d}}]}
    const out=await gem(P[T](b),T==='notes'||T==='words'?CHATM:T==='feedback'||T==='picfb'||T==='wordscheck'||T==='testcheck'||T==='structcheck'?FBM:MODELS,{feedback:1200,picfb:2000,wordscheck:1200,words:400,testgen:1800,testcheck:2600,structgen:800,structcheck:2000}[T]||0,imgs);
    if(T==='words'){if(!Array.isArray(out.words)||out.words.length<5||out.words.some(w=>!w||!w.zh))throw new Error('AI chọn từ chưa đúng định dạng, thử lại.');out.words=out.words.slice(0,5)}
    if(T==='testgen'){const p1=out&&out.part1,ok=p1&&Array.isArray(p1.items)&&p1.items.length&&p1.items.every(x=>x&&x.zh)&&Array.isArray(out.part2)&&out.part2.length&&out.part2.every(x=>x&&x.zh)&&out.part3&&out.part3.zh;if(!ok)throw new Error('AI soạn đề chưa đúng định dạng, thử lại.');p1.mode=b.level>=5?'read':'repeat';p1.items=p1.items.slice(0,5);out.part2=out.part2.slice(0,4);out.theme=b.theme}
    if(T==='structgen'){const ok=out&&Array.isArray(out.items)&&out.items.length&&out.items.every(x=>x&&x.vi);if(!ok)throw new Error('AI chưa ra đúng định dạng câu, thử lại.');out.items=out.items.slice(0,3).map(x=>({vi:String(x.vi).slice(0,200),hint:String(x.hint||'').slice(0,120)}))}
    if(b.task==='scenario'&&(!Array.isArray(out.dialogue)||out.dialogue.length<2||out.dialogue.some(d=>!d||!d.zh)))throw new Error('AI tạo bài chưa đúng định dạng, thử lại.');
    send(200,out);
   }catch(e){send(Number.isInteger(e.code)?e.code:500,{error:e.message||'Lỗi máy chủ'})}});
  return;}
if(req.method==='GET'&&req.url==='/api/status'&&process.env.ENABLE_STATUS==='1'){(async()=>{if(limited(req)){res.writeHead(429);return res.end('slow down')}
  const o={geminiKeys:KEYS.length,geminiCheck:await Promise.all(KEYS.map(async k=>{try{const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',{headers:{'x-goog-api-key':k},signal:AbortSignal.timeout(10000)});return{key:'…'+k.slice(-4),length:k.length,status:r.status,ok:r.ok}}catch(e){return{key:'…'+k.slice(-4),error:e.message}}})),model:MODEL};
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(o,null,1))})();return}
 if(req.url==='/api/health'){res.end('ok');return}
 if(req.url==='/api/models'&&process.env.ENABLE_MODELS==='1'){(async()=>{try{const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',{headers:{'x-goog-api-key':KEYS[ki]||''}});const j=await r.json();res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(r.ok?{current:MODEL,usable:(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace('models/',''))}:j,null,1))}catch(e){res.end(String(e))}})();return}
 const p0=req.url.split('?')[0];if(p0!=='/'&&p0!=='/index.html'){res.writeHead(404);res.end('not found');return}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(__dirname,'index.html')));
}).listen(PORT,()=>console.log('http://localhost:'+PORT));

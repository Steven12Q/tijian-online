let me=null, questions=[], selectedId=null, topicFilter='', currentPage='bank', bankMode='all', editingId=null, users=[];
let paperIds=JSON.parse(localStorage.getItem('tijian-paper')||'[]');
let draftStemImages=[], draftSolutionImages=[], draftLayout={};
let importPayload=null;
const $=s=>document.querySelector(s);
async function api(url,opts={}){const r=await fetch(url,{headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});let data={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(data.error||'请求失败');return data}
function normalizeLatexText(input=''){
  let s=String(input||'').replace(/\r\n/g,'\n');
  // Remove full-line LaTeX comments and document/preamble lines that should not be shown in a question bank.
  s=s.split('\n').filter(line=>!/^\s*%/.test(line) && !/^\s*\\(?:documentclass|usepackage|begin\{document\}|end\{document\}|pagestyle|thispagestyle|hypersetup|setlength|renewcommand|newcommand|titleformat|titlespacing)/.test(line)).join('\n');
  // Common text-mode LaTeX that often appears in teacher solutions.
  s=s.replace(/\\noindent\b/g,'').replace(/\\par\b/g,'\n');
  s=s.replace(/\\(?:section|subsection)\*?\{([^{}]*)\}/g,'\n$1\n');
  s=s.replace(/\\textbf\{([^{}]*)\}/g,'$1').replace(/\\emph\{([^{}]*)\}/g,'$1');
  return s;
}
function latexToHtml(input=''){
  const s=normalizeLatexText(input);
  let out='', i=0, buf='';
  const flush=()=>{ if(!buf)return; let t=escapeHtml(buf); t=t.replace(/\\\\/g,'<br>').replace(/\n/g,'<br>'); out+=t; buf=''; };
  while(i<s.length){
    // Render LaTeX-style fill-in rules even when they are outside $...$.
    // Example: \rule{3cm}{0.4pt}
    if(s.startsWith('\\rule{',i)){
      const m=s.slice(i).match(/^\\rule\{([0-9.]+)(cm|mm|em|px)\}\{([0-9.]+)(pt|mm|px)\}/);
      if(m){
        flush();
        const width=`${m[1]}${m[2]}`;
        out+=`<span class="fill-blank" style="width:${width}"></span>`;
        i+=m[0].length;
        continue;
      }
    }
    let start=null,end=null,open='',close='';
    if(s.startsWith('$$',i)){start=i;open='$$';close='$$';end=s.indexOf('$$',i+2);}
    else if(s.startsWith('\\[',i)){start=i;open='\\[';close='\\]';end=s.indexOf('\\]',i+2);}
    else if(s.startsWith('\\(',i)){start=i;open='\\(';close='\\)';end=s.indexOf('\\)',i+2);}
    else if(s[i]==='$'){start=i;open='$';close='$';let j=i+1;while(j<s.length){if(s[j]==='$'&&s[j-1]!=='\\'){end=j;break}j++;}}
    if(start===null||end===-1||end===null){buf+=s[i++];continue}
    flush(); out+=escapeHtml(s.slice(start,end+close.length)); i=end+close.length;
  }
  flush(); return out;
}
async function renderMath(root=document.body){
  if(!window.MathJax?.typesetPromise)return;
  try{window.MathJax.typesetClear?.([root]); await window.MathJax.typesetPromise([root]);}catch(e){console.warn('MathJax render error',e)}
}
function fallbackLayout(q={}){
  const src=String(q.source||''); const n=String(q.examNumber||'').match(/\d+/)?.[0]||'';
  const key=(src.includes('海淀')?'HD':src.includes('北京卷')?'BJ':'')+'-'+n;
  const m={
    'HD-1':{imagePlacement:'right',align:'top',imageMaxWidthMm:34,textWrap:true,keepWithStem:true},
    'HD-3':{imagePlacement:'right',align:'top',imageMaxWidthMm:42,textWrap:true,keepWithStem:true},
    'HD-7':{imagePlacement:'below',align:'center',imageMaxWidthMm:125,keepWithStem:true},
    'HD-15':{imagePlacement:'right',align:'top',imageMaxWidthMm:45,textWrap:true,keepWithStem:true},
    'HD-19':{imagePlacement:'right',align:'top',imageMaxWidthMm:48,textWrap:true,keepWithStem:true},
    'BJ-10':{imagePlacement:'right',align:'top',imageMaxWidthMm:46,textWrap:true,keepWithStem:true},
    'BJ-14':{imagePlacement:'right',align:'top',imageMaxWidthMm:42,textWrap:true,keepWithStem:true},
    'BJ-18':{imagePlacement:'right',align:'top',imageMaxWidthMm:54,textWrap:true,keepWithStem:true}
  };
  return m[key]||{};
}
function effectiveLayout(q={}) {
  const fb=fallbackLayout(q);
  const db=(q.layout&&typeof q.layout==='object')?q.layout:{};
  return {...fb,...db};
}
function imageBoxStyle(layout={},printMode=false){
  const ratio=Number(printMode?(layout.printWidthRatio??layout.imageWidthRatio):layout.imageWidthRatio);
  const mm=Number(printMode?(layout.printMaxWidthMm??layout.imageMaxWidthMm):layout.imageMaxWidthMm);
  const parts=[];
  if(Number.isFinite(ratio)){const x=Math.max(10,Math.min(100,ratio*100));parts.push(`width:${x}%`,`flex-basis:${x}%`)}
  else if(Number.isFinite(mm)){const x=Math.max(20,Math.min(180,mm));parts.push(`width:${x}mm`,`flex-basis:${x}mm`)}
  else parts.push('width:auto');
  if(Number.isFinite(mm)){const x=Math.max(20,Math.min(180,mm));parts.push(`max-width:${x}mm`)}
  else parts.push('max-width:100%');
  return parts.join(';')+';';
}
function imageHtml(images=[],layout={},printMode=false){
  if(!images?.length)return '';
  const p=layout.imagePlacement||'below';
  const cols=Math.max(1,Math.min(4,Number(layout.gridColumns)||1));
  const gap=Math.max(0,Math.min(40,Number(layout.imageGapPx)||12));
  const cls=`question-images placement-${p} align-${layout.align||'left'}${images.length>1?' multi-layout':''}`;
  const st=imageBoxStyle(layout,printMode)+`--img-cols:${cols};--img-gap:${gap}px;`;
  return `<div class="${cls}" style="${st}">${images.map(src=>`<img src="${escapeHtml(src)}" loading="lazy" alt="题目配图">`).join('')}</div>`;
}
function questionBodyHtml(q){
  const stem=`<div class="math-content question-stem">${latexToHtml(q.stem)}</div>`;
  const layout=effectiveLayout(q);
  const imgs=imageHtml(q.stemImages||[],layout,false);
  const p=layout.imagePlacement||'below';
  return (p==='right'||p==='left')?`<div class="question-flow flow-${p}">${stem}${imgs}</div>`:`${stem}${imgs}`;
}
function layoutFromForm(){
  const pct=Number($('#fImageWidthPct').value);
  const mm=$('#fImageMaxMm').value.trim()===''?undefined:Number($('#fImageMaxMm').value);
  const ppct=$('#fPrintWidthPct').value.trim()===''?undefined:Number($('#fPrintWidthPct').value);
  const pmm=$('#fPrintMaxMm').value.trim()===''?undefined:Number($('#fPrintMaxMm').value);
  return {
    imagePlacement:$('#fImagePlacement').value,
    align:$('#fImageAlign').value,
    imageWidthRatio:Number.isFinite(pct)?Math.max(.1,Math.min(1,pct/100)):.7,
    imageMaxWidthMm:Number.isFinite(mm)?mm:undefined,
    gridColumns:Number($('#fImageGridCols').value)||1,
    imageGapPx:Number($('#fImageGap').value)||0,
    printWidthRatio:Number.isFinite(ppct)?Math.max(.1,Math.min(1,ppct/100)):undefined,
    printMaxWidthMm:Number.isFinite(pmm)?pmm:undefined,
    textWrap:$('#fTextWrap').checked,
    keepWithStem:$('#fKeepWithStem').checked,
    pageBreakInsideAvoid:true
  };
}
function loadLayoutToForm(layout={}){
  const l={imagePlacement:'below',align:'left',imageWidthRatio:.7,gridColumns:1,imageGapPx:12,keepWithStem:true,...layout};
  $('#fImagePlacement').value=l.imagePlacement||'below';
  $('#fImageAlign').value=l.align||'left';
  $('#fImageWidthPct').value=Math.round((Number(l.imageWidthRatio)||.7)*100);
  $('#fImageMaxMm').value=Number.isFinite(Number(l.imageMaxWidthMm))?Number(l.imageMaxWidthMm):'';
  $('#fImageGridCols').value=String(Math.max(1,Math.min(4,Number(l.gridColumns)||1)));
  $('#fImageGap').value=Number.isFinite(Number(l.imageGapPx))?Number(l.imageGapPx):12;
  $('#fPrintWidthPct').value=Number.isFinite(Number(l.printWidthRatio))?Math.round(Number(l.printWidthRatio)*100):'';
  $('#fPrintMaxMm').value=Number.isFinite(Number(l.printMaxWidthMm))?Number(l.printMaxWidthMm):'';
  $('#fTextWrap').checked=Boolean(l.textWrap);
  $('#fKeepWithStem').checked=l.keepWithStem!==false;
  draftLayout={...l};
  refreshLayoutPreview();
}
function refreshLayoutPreview(){
  const el=$('#layoutLivePreview');if(!el)return;
  const layout=layoutFromForm();
  draftLayout=layout;
  if(!draftStemImages.length){el.innerHTML='<span>上传题目配图后可在这里预览。</span>';return}
  const imgs=imageHtml(draftStemImages,layout,false);
  const sample='<div class="layout-sample-text">题干文字示例：图片会按照当前参数与题干组合显示。</div>';
  const p=layout.imagePlacement||'below';
  el.innerHTML=(p==='right'||p==='left')?`<div class="question-flow flow-${p}">${sample}${imgs}</div>`:`${sample}${imgs}`;
}
function applyLayoutPreset(name){
  const presets={
    'right-small':{imagePlacement:'right',align:'left',imageWidthRatio:.28,imageMaxWidthMm:52,gridColumns:1,imageGapPx:10,textWrap:true,keepWithStem:true},
    'below-wide':{imagePlacement:'below',align:'center',imageWidthRatio:.85,imageMaxWidthMm:150,gridColumns:1,imageGapPx:10,textWrap:false,keepWithStem:true},
    'four-grid':{imagePlacement:'below',align:'left',imageWidthRatio:.95,imageMaxWidthMm:165,gridColumns:4,imageGapPx:12,textWrap:false,keepWithStem:true},
    'full':{imagePlacement:'below',align:'center',imageWidthRatio:1,imageMaxWidthMm:180,gridColumns:1,imageGapPx:10,textWrap:false,keepWithStem:true},
    'reset':{imagePlacement:'below',align:'left',imageWidthRatio:.7,imageMaxWidthMm:undefined,gridColumns:1,imageGapPx:12,textWrap:false,keepWithStem:true}
  };
  loadLayoutToForm(presets[name]||presets.reset);
}
function refreshImagePreview(kind){const arr=kind==='stem'?draftStemImages:draftSolutionImages;const el=$(kind==='stem'?'#stemImagePreview':'#solutionImagePreview');if(!el)return;el.innerHTML=arr.map((src,i)=>`<div class="image-chip"><img src="${escapeHtml(src)}"><button type="button" data-img-kind="${kind}" data-img-index="${i}">×</button></div>`).join('');el.querySelectorAll('button').forEach(b=>b.onclick=()=>{const a=b.dataset.imgKind==='stem'?draftStemImages:draftSolutionImages;a.splice(Number(b.dataset.imgIndex),1);refreshImagePreview(b.dataset.imgKind);if(b.dataset.imgKind==='stem')refreshLayoutPreview()})}
async function filesToDataUrls(fileList){const files=[...fileList];if(files.length>6)throw new Error('一次最多上传 6 张图片');const out=[];for(const f of files){if(f.size>1_800_000)throw new Error(`图片 ${f.name} 超过 1.8MB，请先压缩`);if(!/^image\//.test(f.type))throw new Error(`${f.name} 不是图片文件`);out.push(await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f)}));}return out}
function stripTex(s=''){return s.replace(/\\[a-zA-Z]+/g,'').replace(/[${}]/g,'').slice(0,120)}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function savePaper(){localStorage.setItem('tijian-paper',JSON.stringify(paperIds));renderPaperBadge()}
function renderPaperBadge(){$('#paperBadge').textContent=paperIds.length}
function validateImportPayload(obj){
  const qs=Array.isArray(obj)?obj:(Array.isArray(obj?.questions)?obj.questions:[]);
  if(!qs.length)throw new Error('文件中没有找到 questions 数组');
  if(qs.length>500)throw new Error('一次最多导入 500 道题');
  return {questions:qs,meta:obj?.meta||obj?.source||{}};
}
function renderImportPreview(){
  const el=$('#importPreview');
  if(!importPayload){el.textContent='尚未选择文件';return}
  const qs=importPayload.questions;
  const exams=[...new Set(qs.map(q=>q.source).filter(Boolean))];
  const chapters=[...new Set(qs.map(q=>q.chapter||q.topic).filter(Boolean))];
  el.innerHTML=`<b>识别到 ${qs.length} 道题</b><div>试卷：${escapeHtml(exams.slice(0,3).join('、')||'未填写')}</div><div>章节：${escapeHtml(chapters.slice(0,6).join('、')||'未填写')}</div><div class="mini">前 5 题：${qs.slice(0,5).map(q=>escapeHtml(`${q.examNumber||''} ${q.title||'未命名'}`)).join('；')}</div>`;
}
function openImport(){importPayload=null;$('#importFile').value='';$('#importResult').textContent='';$('#doImport').disabled=true;renderImportPreview();$('#importModal').classList.remove('hidden')}
async function handleImportFile(file){
  try{
    if(!file)return;
    if(file.size>12_000_000)throw new Error('导入文件超过 12MB');
    const text=await file.text();
    importPayload=validateImportPayload(JSON.parse(text));
    renderImportPreview();$('#doImport').disabled=false;$('#importResult').textContent='文件检查通过，可以开始导入。';
  }catch(e){importPayload=null;$('#doImport').disabled=true;$('#importResult').textContent='读取失败：'+e.message;renderImportPreview()}
}
async function doBatchImport(){
  if(!importPayload)return;
  const btn=$('#doImport');btn.disabled=true;btn.textContent='正在导入…';$('#importResult').textContent='';
  try{
    const d=await api('/api/import/questions',{method:'POST',body:JSON.stringify({questions:importPayload.questions,onDuplicate:$('#duplicateMode').value})});
    $('#importResult').textContent=`完成：新增 ${d.imported}，覆盖 ${d.replaced}，跳过 ${d.skipped}，失败 ${d.failed}。`;
    await loadQuestions();
  }catch(e){$('#importResult').textContent='导入失败：'+e.message}
  finally{btn.disabled=false;btn.textContent='开始导入'}
}
async function login(){try{const d=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})});me=d.user;showApp();await loadQuestions()}catch(e){$('#loginError').textContent=e.message}}
async function showApp(){if(!me){try{me=(await api('/api/me')).user}catch{return}}$('#login').classList.add('hidden');$('#app').classList.remove('hidden');$('#userName').textContent=`${me.name} · ${me.role==='admin'?'管理员':'教师'}`;if(me.role==='admin')$('#navUsers').classList.remove('hidden');renderPaperBadge()}
async function loadQuestions(){try{questions=(await api('/api/questions')).questions;paperIds=paperIds.filter(id=>questions.some(q=>q.id===id));savePaper();renderAll()}catch(e){if(e.message==='未登录')location.reload()}}
function naturalExamNo(v=''){const m=String(v).match(/\d+/);return m?Number(m[0]):9999}
function examQuestions(source){
  return questions.filter(q=>q.source===source).sort((x,y)=>naturalExamNo(x.examNumber)-naturalExamNo(y.examNumber)||String(x.examNumber||'').localeCompare(String(y.examNumber||''),'zh-CN'));
}
function addWholeExamToPaper(source){
  const qs=examQuestions(source);
  if(!qs.length)return alert('这套试卷暂时没有题目');
  const existing=new Set(paperIds);
  qs.forEach(q=>existing.add(q.id));
  paperIds=Array.from(existing);
  savePaper();
  alert(`已将《${source}》的 ${qs.length} 道题加入组卷。`);
}
function renderExamExportBar(){
  const bar=$('#examExportBar');
  if(!bar)return;
  if(bankMode!=='exam'||!topicFilter){
    bar.classList.add('hidden');
    bar.innerHTML='';
    return;
  }
  const qs=examQuestions(topicFilter);
  bar.classList.remove('hidden');
  bar.innerHTML=`<div class="exam-export-info"><b>${escapeHtml(topicFilter)}</b><span>${qs.length} 道题 · 按原题号自动排序</span></div><div class="exam-export-actions"><button id="addWholeExam" class="ghost">＋ 整卷加入组卷</button><button id="exportWholeStudent" class="primary">导出整卷学生版 PDF</button><button id="exportWholeTeacher" class="primary">导出整卷教师版 PDF</button></div>`;
  $('#addWholeExam').onclick=()=>addWholeExamToPaper(topicFilter);
  $('#exportWholeStudent').onclick=()=>exportWholeExam(topicFilter,'student');
  $('#exportWholeTeacher').onclick=()=>exportWholeExam(topicFilter,'teacher');
}
function renderTopics(){
  const counts={}; let field='topic'; let title='知识板块';
  if(bankMode==='chapter'){field='chapter';title='章节分类'}
  if(bankMode==='exam'){field='source';title='来源试卷'}
  questions.forEach(q=>{const k=q[field]||'未分类';counts[k]=(counts[k]||0)+1});
  $('#classifyTitle').textContent=title;
  $('#topics').innerHTML='<div class="topic '+(!topicFilter?'active':'')+'" data-topic="">全部题目 <span>'+questions.length+'</span></div>'+Object.entries(counts).sort((a,b)=>a[0].localeCompare(b[0],'zh-CN')).map(([k,v])=>`<div class="topic ${topicFilter===k?'active':''}" data-topic="${escapeHtml(k)}">${escapeHtml(k)} <span>${v}</span></div>`).join('');
  document.querySelectorAll('.topic').forEach(x=>x.onclick=()=>{topicFilter=x.dataset.topic;renderAll()})
}
function filtered(){
  const s=$('#search').value.trim().toLowerCase(),t=$('#typeFilter').value,d=$('#difficultyFilter').value;
  let fs=questions.filter(q=>{
    const classValue=bankMode==='chapter'?(q.chapter||q.topic):bankMode==='exam'?q.source:q.topic;
    return (!topicFilter||classValue===topicFilter)&&(!t||q.type===t)&&(!d||q.difficulty===d)&&(!s||[q.title,q.stem,q.source,q.topic,q.chapter,q.examNumber,...q.tags].join(' ').toLowerCase().includes(s))
  });
  if(bankMode==='exam'&&topicFilter) fs=[...fs].sort((x,y)=>naturalExamNo(x.examNumber)-naturalExamNo(y.examNumber)||String(x.examNumber).localeCompare(String(y.examNumber),'zh-CN'));
  return fs
}
function renderList(){const fs=filtered();$('#foundText').textContent=`找到 ${fs.length} 道题`;$('#countBadge').textContent=questions.length;$('#questionList').innerHTML=fs.map(q=>`<article class="q-card ${selectedId===q.id?'active':''}" data-id="${q.id}"><div class="q-meta"><span class="pill">${escapeHtml(q.type)}</span>${escapeHtml(q.grade)} · ${escapeHtml(q.source)}${q.examNumber?` · 第${escapeHtml(q.examNumber)}题`:''}</div><h4>${escapeHtml(q.title)}</h4><div class="q-preview">${escapeHtml(stripTex(q.stem))}</div><div class="q-foot"><span>${escapeHtml(q.chapter||q.topic)} / ${escapeHtml(q.topic)}</span><span class="difficulty">${escapeHtml(q.difficulty)}</span></div></article>`).join('')||'<div class="empty" style="height:200px">没有匹配题目</div>';document.querySelectorAll('.q-card').forEach(x=>x.onclick=()=>{selectedId=x.dataset.id;renderAll()})}
function paperButton(q){const added=paperIds.includes(q.id);return `<button id="paperAction" class="ghost ${added?'added-paper':'add-paper'}">${added?'✓ 已加入试卷':'＋ 加入试卷'}</button>`}
function renderDetail(){const q=questions.find(x=>x.id===selectedId)||filtered()[0];if(!q){$('#detail').innerHTML='<div class="empty">选择左侧题目查看详情</div>';return}selectedId=q.id;$('#detail').innerHTML=`<div class="detail-tools">${paperButton(q)}<button id="editAction" class="ghost">编辑题目</button></div><div class="detail-top"><div><div class="q-meta"><span class="pill">${escapeHtml(q.type)}</span>${escapeHtml(q.grade)}　<span class="pill">${escapeHtml(q.difficulty)}</span></div><h3>${escapeHtml(q.title)}</h3><div class="detail-source">章节：${escapeHtml(q.chapter||q.topic)}　·　知识板块：${escapeHtml(q.topic)}</div><div class="detail-source">来源试卷：${escapeHtml(q.source)}${q.examNumber?`　·　第 ${escapeHtml(q.examNumber)} 题`:''}</div></div><div class="detail-source">更新于 ${new Date(q.updatedAt).toLocaleString()}</div></div><div class="detail-block"><h5>题目</h5>${questionBodyHtml(q)}</div><div class="answer-box"><h5>答案</h5><div class="math-content">${latexToHtml(q.answer)}</div><hr style="border:0;border-top:1px solid #dce6f2;margin:18px 0"><h5>解析</h5><div class="math-content">${latexToHtml(q.solution)}</div>${imageHtml(q.solutionImages)}</div><div class="tags">${q.tags.map(t=>`<span class="tag"># ${escapeHtml(t)}</span>`).join('')}<span class="tag">录入：${escapeHtml(q.createdBy)}</span><span class="tag">最近编辑：${escapeHtml(q.updatedBy)}</span></div>`;$('#paperAction').onclick=()=>togglePaper(q.id);$('#editAction').onclick=()=>openEdit(q);renderMath($('#detail'))}
function renderAll(){if(!['bank','chapters','exams'].includes(currentPage))return;renderTopics();renderExamExportBar();renderList();renderDetail()}
function switchPage(page){
  if(page==='chapters'||page==='exams'||page==='bank'){
    currentPage=page; bankMode=page==='chapters'?'chapter':page==='exams'?'exam':'all'; topicFilter='';
    $('#bankPage').classList.remove('hidden'); $('#paperPage').classList.add('hidden'); $('#usersPage').classList.add('hidden');
  } else {currentPage=page;$('#bankPage').classList.add('hidden');$('#paperPage').classList.toggle('hidden',page!=='paper');$('#usersPage').classList.toggle('hidden',page!=='users')}
  ['Bank','Chapters','Exams','Paper','Users'].forEach(n=>$('#nav'+n)?.classList.remove('active'));
  $('#nav'+page[0].toUpperCase()+page.slice(1))?.classList.add('active');
  $('#topicArea').classList.toggle('hidden',page==='paper'||page==='users');$('#addBtn').classList.toggle('hidden',page==='users');
  const map={bank:['SHARED QUESTION BANK','共享题库'],chapters:['BROWSE BY CHAPTER','按章节浏览'],exams:['BROWSE BY EXAM','按试卷浏览'],paper:['PAPER BUILDER','选题组卷'],users:['USER MANAGEMENT','教师账号']};
  $('#eyebrow').textContent=map[page][0];$('#pageTitle').textContent=map[page][1];
  if(['bank','chapters','exams'].includes(page))renderAll();if(page==='paper')renderPaper();if(page==='users')loadUsers()
}
function togglePaper(id){paperIds=paperIds.includes(id)?paperIds.filter(x=>x!==id):[...paperIds,id];savePaper();renderDetail();if(currentPage==='paper')renderPaper()}
function renderPaper(){const qs=paperIds.map(id=>questions.find(q=>q.id===id)).filter(Boolean);$('#paperCountText').textContent=`${qs.length} 道题`;$('#paperList').innerHTML=qs.length?qs.map((q,i)=>`<div class="paper-item"><div class="paper-num">${i+1}.</div><div class="paper-main"><h4>${escapeHtml(q.title)}</h4>${questionBodyHtml(q)}<div class="mini">${escapeHtml(q.type)} · ${escapeHtml(q.source)}</div></div><div class="paper-row-actions"><button class="ghost tiny" data-up="${q.id}">↑</button><button class="ghost tiny" data-down="${q.id}">↓</button><button class="danger tiny" data-remove="${q.id}">移除</button></div></div>`).join(''):'<div class="empty" style="height:220px">还没有选题。回到共享题库，点击“加入试卷”。</div>';document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>togglePaper(b.dataset.remove));document.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>movePaper(b.dataset.up,-1));document.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>movePaper(b.dataset.down,1));renderMath($('#paperList'))}
function movePaper(id,dir){const i=paperIds.indexOf(id),j=i+dir;if(i<0||j<0||j>=paperIds.length)return;[paperIds[i],paperIds[j]]=[paperIds[j],paperIds[i]];savePaper();renderPaper()}
function openCreate(){editingId=null;draftStemImages=[];draftSolutionImages=[];draftLayout={};$('#modalTitle').textContent='录入新题';['fTitle','fSource','fExamNumber','fStem','fAnswer','fSolution','fTags'].forEach(id=>$('#'+id).value='');$('#fChapter').value='函数';$('#fTopic').value='函数与导数';$('#fType').value='解答题';$('#fDifficulty').value='中档';$('#fGrade').value='高三';$('#fStemImages').value='';$('#fSolutionImages').value='';refreshImagePreview('stem');refreshImagePreview('solution');loadLayoutToForm({});$('#deleteQuestion').classList.add('hidden');$('#modal').classList.remove('hidden')}
function openEdit(q){editingId=q.id;draftStemImages=[...(q.stemImages||[])];draftSolutionImages=[...(q.solutionImages||[])];draftLayout={...(q.layout||{})};$('#modalTitle').textContent='编辑题目';$('#fTitle').value=q.title;$('#fChapter').value=q.chapter||q.topic;$('#fTopic').value=q.topic;$('#fType').value=q.type;$('#fDifficulty').value=q.difficulty;$('#fGrade').value=q.grade;$('#fTags').value=(q.tags||[]).join(', ');$('#fSource').value=q.source;$('#fExamNumber').value=q.examNumber||'';$('#fStem').value=q.stem;$('#fAnswer').value=q.answer;$('#fSolution').value=q.solution;$('#fStemImages').value='';$('#fSolutionImages').value='';refreshImagePreview('stem');refreshImagePreview('solution');loadLayoutToForm(effectiveLayout(q));$('#deleteQuestion').classList.toggle('hidden',me.role!=='admin');$('#modal').classList.remove('hidden')}
async function saveQuestion(){const b={title:$('#fTitle').value,chapter:$('#fChapter').value,topic:$('#fTopic').value,type:$('#fType').value,difficulty:$('#fDifficulty').value,grade:$('#fGrade').value,tags:$('#fTags').value,source:$('#fSource').value,examNumber:$('#fExamNumber').value,stem:$('#fStem').value,answer:$('#fAnswer').value,solution:$('#fSolution').value,stemImages:draftStemImages,solutionImages:draftSolutionImages,layout:layoutFromForm()};if(!b.title||!b.stem)return alert('请至少填写标题和题干');try{const d=await api(editingId?`/api/questions/${encodeURIComponent(editingId)}`:'/api/questions',{method:editingId?'PUT':'POST',body:JSON.stringify(b)});$('#modal').classList.add('hidden');selectedId=d.question.id;await loadQuestions()}catch(e){alert(e.message)}}
async function deleteQuestion(){if(!editingId||!confirm('确定删除这道题吗？此操作不可撤销。'))return;try{await api(`/api/questions/${encodeURIComponent(editingId)}`,{method:'DELETE'});paperIds=paperIds.filter(x=>x!==editingId);savePaper();selectedId=null;$('#modal').classList.add('hidden');await loadQuestions()}catch(e){alert(e.message)}}
async function loadUsers(){if(me.role!=='admin')return;try{users=(await api('/api/users')).users;renderUsers()}catch(e){alert(e.message)}}
function renderUsers(){$('#userList').innerHTML=users.map(u=>`<div class="user-row"><div class="user-info"><b>${escapeHtml(u.name)} <span class="pill">${u.role==='admin'?'管理员':'教师'}</span></b><span>用户名：${escapeHtml(u.username)} · ${u.active?'启用':'已停用'}</span></div>${u.role==='teacher'?`<button class="ghost tiny" data-active="${u.id}" data-next="${u.active?'0':'1'}">${u.active?'停用':'启用'}</button>`:''}</div>`).join('');document.querySelectorAll('[data-active]').forEach(b=>b.onclick=()=>toggleUser(b.dataset.active,b.dataset.next==='1'))}
async function createTeacher(){const b={username:$('#newUsername').value,name:$('#newName').value,password:$('#newPassword').value};try{await api('/api/users',{method:'POST',body:JSON.stringify(b)});$('#userMsg').textContent='教师账号已创建。';$('#newUsername').value=$('#newName').value=$('#newPassword').value='';await loadUsers()}catch(e){$('#userMsg').textContent=e.message}}
async function toggleUser(id,active){try{await api(`/api/users/${id}`,{method:'PATCH',body:JSON.stringify({active})});await loadUsers()}catch(e){alert(e.message)}}

function stripLatexForLength(s=''){
  return String(s)
    .replace(/\$+/g,'')
    .replace(/\\dfrac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,'$1/$2')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g,'')
    .replace(/[{}\\]/g,'')
    .replace(/\s+/g,' ')
    .trim();
}
function visualTextWidth(s=''){
  const t=stripLatexForLength(s);
  let w=0;
  for(const ch of t){
    if(/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) w+=2;
    else if(/[A-Z]/.test(ch)) w+=1.15;
    else if(/[0-9a-z]/.test(ch)) w+=.9;
    else if(/\s/.test(ch)) w+=.35;
    else w+=.75;
  }
  return w;
}
function splitStemChoices(stem=''){
  const text=String(stem).replace(/\r/g,'');
  // Supports A. / A、 / (A) / （A） and the Chinese full-width equivalents.
  const re=/(?:^|\s|\n)(?:\(|（)?([ABCD])(?:\)|）|[\.．、])\s*/g;
  const matches=[];
  let m;
  while((m=re.exec(text))!==null){
    matches.push({letter:m[1],start:m.index,prefixEnd:re.lastIndex});
  }
  if(matches.length<4) return null;
  // Keep the last complete A-B-C-D sequence to avoid accidental letters in prose.
  let seq=null;
  for(let i=0;i<=matches.length-4;i++){
    if(matches[i].letter==='A'&&matches[i+1].letter==='B'&&matches[i+2].letter==='C'&&matches[i+3].letter==='D'){
      seq=matches.slice(i,i+4);
    }
  }
  if(!seq) return null;
  const stemText=text.slice(0,seq[0].start).trim();
  const options=seq.map((x,i)=>{
    const end=i<3?seq[i+1].start:text.length;
    return {letter:x.letter,text:text.slice(x.prefixEnd,end).trim()};
  });
  return {stemText,options};
}
function optionGridCols(options=[]){
  const widths=options.map(o=>visualTextWidth(o.text));
  const total=widths.reduce((a,b)=>a+b,0);
  const max=Math.max(...widths,0);
  // Global formal-paper rule:
  // 4 columns: short options, one line A/B/C/D.
  // 2 columns: medium options, A/B then C/D.
  // 1 column: long options, each option on its own full-width row.
  if(max<=14.5 && total<=48) return 4;
  if(max<=36 && total<=105) return 2;
  return 1;
}
// Serialize once: template literals must not consume TeX delimiter backslashes.
function exportMathJaxConfig(){
  return {tex:{inlineMath:[['$','$'],['\\(','\\)']],displayMath:[['$$','$$'],['\\[','\\]']],processEscapes:true,macros:{vv:['\\overrightarrow{#1}',1],bm:['\\boldsymbol{#1}',1]}}};
}
function printStemParts(q,number=null){
  const prefix=number===null?'':`<span class="num">${number}.</span> `;
  const split=splitStemChoices(q.stem);
  if(!split){
    return {prompt:`<div class="stem stem-main">${prefix}${latexToHtml(q.stem).replace(/^(?:\s|<br>)+/g,'')}</div>`,options:''};
  }
  const cols=optionGridCols(split.options);
  const prompt=`<div class="stem stem-main">${prefix}${latexToHtml(split.stemText).replace(/^(?:\s|<br>)+/g,'')}</div>`;
  const options=`<div class="choice-grid cols-${cols}">${split.options.map(o=>`<div class="choice"><span class="choice-label">${o.letter}.</span> ${latexToHtml(o.text).replace(/^(?:\s|<br>)+/g,'')}</div>`).join('')}</div>`;
  return {prompt,options};
}
function printStemHtml(q){
  const p=printStemParts(q);
  return p.prompt+p.options;
}
function printQuestionBody(q,number=null){
  const parts=printStemParts(q,number);
  const layout=effectiveLayout(q);
  const p=layout.imagePlacement||'below';
  let imgs='';
  if(q.stemImages?.length){
    const cols=Math.max(1,Math.min(4,Number(layout.gridColumns)||1));
    const gap=Math.max(0,Math.min(40,Number(layout.imageGapPx)||12));
    const st=imageBoxStyle(layout,true)+`--img-cols:${cols};--img-gap:${gap}px;`;
    imgs=`<div class="imgs question-images placement-${p} align-${layout.align||'left'}${q.stemImages.length>1?' multi-layout':''}" style="${st}">${q.stemImages.map(src=>`<img src="${escapeHtml(src)}">`).join('')}</div>`;
  }
  if(p==='right'||p==='left'){
    return `<div class="qflow ${p}"><div class="qprompt">${parts.prompt}</div>${imgs}</div>${parts.options}`;
  }
  return `${parts.prompt}${imgs}${parts.options}`;
}
function teacherAnswerHtml(q){
  const answer=q.answer?`<div class="teacher-answer"><b>答案：</b><span>${latexToHtml(q.answer)}</span></div>`:'';
  const solution=q.solution?`<div class="teacher-solution"><b>解析：</b><div>${latexToHtml(q.solution)}</div></div>`:'';
  const simgs=q.solutionImages?.length?`<div class="teacher-solution-images">${q.solutionImages.map(src=>`<img src="${escapeHtml(src)}">`).join('')}</div>`:'';
  return `<div class="teacher-block">${answer}${solution}${simgs}</div>`;
}
function exportPaper(mode='student',qsOverride=null,titleOverride=null,subtitleOverride=null){const title=escapeHtml(titleOverride||$('#paperTitle').value||'高中数学练习');const qs=Array.isArray(qsOverride)?qsOverride:paperIds.map(id=>questions.find(q=>q.id===id)).filter(Boolean);if(!qs.length)return alert('请先选择题目');const teacher=mode==='teacher';const versionText=teacher?'教师版':'学生版';const mathConfig=`<script>window.MathJax=${JSON.stringify(exportMathJaxConfig())};<\/script><script defer src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" onload="setTimeout(()=>window.print(),700)"><\/script>`;const html=`<!doctype html><html><head><meta charset="utf-8"><title>${title}-${versionText}</title>${mathConfig}<style>*{box-sizing:border-box}html,body{padding:0;margin:0}body{font-family:'Microsoft YaHei','Noto Sans CJK SC',sans-serif;color:#111;font-size:11.2pt;line-height:1.45}main{width:100%;margin:0 auto}h1{text-align:center;font-size:18pt;line-height:1.2;margin:0 0 2.5mm;font-weight:700}.sub{text-align:center;color:#444;font-size:10.5pt;line-height:1.25;margin:0 0 3.5mm}.version{text-align:center;font-size:9.5pt;color:#666;margin:-2mm 0 3mm}.q{display:block;margin:0 0 2.8mm;page-break-inside:avoid;break-inside:avoid}.num{font-weight:400;white-space:nowrap}.stem-main{padding-left:7mm;text-indent:-7mm}.choice-grid{padding-left:7mm}.student-info{text-align:center;font-size:11.2pt;margin:5mm 0 6mm;white-space:nowrap}.student-info span{display:inline-block;width:19mm;border-bottom:.25mm solid #111;margin-right:1.5mm}.qcontent{min-width:0}.stem{line-height:1.45}.stem p{margin:0}.stem br{line-height:1.1}.choice-grid{display:grid;width:100%;column-gap:6mm;row-gap:1.2mm;margin:1.4mm 0 .8mm;align-items:start}.choice-grid.cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}.choice-grid.cols-2{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:10mm;row-gap:1.6mm}.choice-grid.cols-1{grid-template-columns:1fr;row-gap:1.2mm}.choice{display:block;min-width:0;padding-left:5mm;text-indent:-5mm}.fill-blank{display:inline-block;border-bottom:.35mm solid #111;height:.9em;vertical-align:-.08em;min-width:12mm;margin:0 .7mm}.choice-label{font-weight:400;white-space:nowrap}.choice-text{min-width:0}.qflow{display:flex;gap:4.5mm;align-items:flex-start}.qflow .qprompt{flex:1;min-width:0}.qflow.left{flex-direction:row-reverse}.qflow .imgs{flex:0 0 auto;margin:0}.imgs{display:grid;grid-template-columns:repeat(var(--img-cols,1),minmax(0,1fr));gap:var(--img-gap,8px);margin:1.0mm 0 1.2mm}.imgs img{display:block;width:100%;max-width:100%;height:auto;object-fit:contain}.placement-right,.placement-left{justify-content:flex-start}.haidian-q7-grid-print{display:grid!important;grid-template-columns:repeat(4,1fr);gap:3mm;width:145mm;max-width:100%;margin:1.2mm 0 1.5mm!important}.haidian-q7-grid-print img{width:100%!important;max-width:100%!important;height:auto!important}.print-hd-q7{width:94%;margin:1.2mm 0 1.5mm}.print-hd-q7 img{display:block;width:100%;height:auto}.print-hd-q15{display:grid;grid-template-columns:minmax(0,1fr) 42mm;gap:4mm;align-items:start}.print-hd-q15-img img{display:block;width:42mm;height:auto}.teacher-block{margin:2mm 0 1mm;padding:2.3mm 3mm;background:#f5f7fa;border-left:1.2mm solid #7da8df;page-break-inside:avoid;break-inside:avoid}.teacher-answer{margin-bottom:1.4mm}.teacher-solution{line-height:1.42}.teacher-solution>b{display:block;margin-bottom:.5mm}.teacher-solution p{margin:0}.teacher-solution-images{display:flex;gap:2mm;flex-wrap:wrap;margin-top:1mm}.teacher-solution-images img{max-width:80mm;height:auto}mjx-container{margin-top:0!important;margin-bottom:0!important}@page{size:A4;margin:10mm 12mm 11mm;@top-left{content:none}@top-center{content:none}@top-right{content:none}@bottom-left{content:none}@bottom-center{content:counter(page) " / " counter(pages);font-family:Arial,sans-serif;font-size:9pt;color:#111}@bottom-right{content:none}}</style></head><body><main><h1>${title}</h1>${teacher?'':'<div class="student-info">班级：<span></span> 学号：<span></span> 姓名：<span></span> 成绩：<span></span></div>'}${qs.map((q,i)=>`<div class="q"><div class="qcontent">${printQuestionBody(q,i+1)}${teacher?teacherAnswerHtml(q):''}</div></div>`).join('')}</main><script>(${window.installPaperImageCleanup.toString()})();<\/script></body></html>`;const w=window.open('','_blank');w.document.write(html);w.document.close()}
function printPaper(){return exportPaper('student')}
function exportWholeExam(source,mode='student'){
  const qs=examQuestions(source);
  if(!qs.length)return alert('这套试卷暂时没有题目');
  exportPaper(mode,qs,source,'');
}

$('#loginBtn').onclick=login;$('#password').addEventListener('keydown',e=>{if(e.key==='Enter')login()});$('#logoutBtn').onclick=async()=>{await api('/api/logout',{method:'POST'});location.reload()};$('#importBtn').onclick=openImport;$('#addBtn').onclick=openCreate;$('#closeModal').onclick=()=>$('#modal').classList.add('hidden');$('#closeImportModal').onclick=()=>$('#importModal').classList.add('hidden');$('#importFile').addEventListener('change',e=>handleImportFile(e.target.files?.[0]));$('#doImport').onclick=doBatchImport;$('#saveQuestion').onclick=saveQuestion;$('#deleteQuestion').onclick=deleteQuestion;$('#navBank').onclick=()=>switchPage('bank');$('#navChapters').onclick=()=>switchPage('chapters');$('#navExams').onclick=()=>switchPage('exams');$('#navPaper').onclick=()=>switchPage('paper');$('#navUsers').onclick=()=>switchPage('users');$('#clearPaper').onclick=()=>{if(confirm('清空当前试卷选题？')){paperIds=[];savePaper();renderPaper()}};$('#exportStudentPdf').onclick=()=>exportPaper('student');$('#exportTeacherPdf').onclick=()=>exportPaper('teacher');$('#createTeacher').onclick=createTeacher;['search','typeFilter','difficultyFilter'].forEach(id=>$('#'+id).addEventListener(id==='search'?'input':'change',renderAll));
$('#fStemImages').addEventListener('change',async e=>{try{draftStemImages.push(...await filesToDataUrls(e.target.files));refreshImagePreview('stem');refreshLayoutPreview();e.target.value=''}catch(err){alert(err.message)}});
document.querySelectorAll('[data-layout-preset]').forEach(b=>b.addEventListener('click',()=>applyLayoutPreset(b.dataset.layoutPreset)));
['fImagePlacement','fImageAlign','fImageWidthPct','fImageMaxMm','fImageGridCols','fImageGap','fPrintWidthPct','fPrintMaxMm','fTextWrap','fKeepWithStem'].forEach(id=>$('#'+id)?.addEventListener('input',refreshLayoutPreview));
['fImagePlacement','fImageAlign','fImageGridCols','fTextWrap','fKeepWithStem'].forEach(id=>$('#'+id)?.addEventListener('change',refreshLayoutPreview));
$('#fSolutionImages').addEventListener('change',async e=>{try{draftSolutionImages.push(...await filesToDataUrls(e.target.files));refreshImagePreview('solution');e.target.value=''}catch(err){alert(err.message)}});
(async()=>{try{me=(await api('/api/me')).user;await showApp();await loadQuestions()}catch{}})();setInterval(()=>{if(me&&currentPage==='bank')loadQuestions()},15000);

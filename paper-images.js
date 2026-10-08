// Improve photographed monochrome diagrams without changing the stored originals.
function installPaperImageCleanup() {
  const selector = '.question-images img,.image-chip img,.imgs img,.teacher-solution-images img,.print-hd-q7 img,.print-hd-q15-img img,.haidian-q7-grid-print img';
  const style = document.createElement('style');
  style.textContent = 'img.paper-white{filter:grayscale(1) contrast(2.6) brightness(1.2);background:#fff!important}';
  document.head.appendChild(style);
  const seen = new WeakMap();
  function process(img) {
    if (seen.get(img) === img.src) return;
    seen.set(img, img.src);
    img.classList.remove('paper-white');
    function check() {
      if (!img.naturalWidth) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = Math.max(16, Math.min(96, Math.round(96 * img.naturalHeight / img.naturalWidth)));
        const ctx = canvas.getContext('2d', {willReadFrequently:true});
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
        let count=0, paper=0, colored=0;
        for(let i=0;i<pixels.length;i+=4){
          if(pixels[i+3]<200) continue;
          const r=pixels[i],g=pixels[i+1],b=pixels[i+2];
          count++;
          const yellow = r>140 && g>100 && b>75 && r>=g-4 && r-g<65 && g-b>7 && r-b<120;
          if(yellow) paper++;
          else if(Math.max(r,g,b)-Math.min(r,g,b)>55) colored++;
        }
        // Leave colored plots, transparent assets and already-white diagrams alone.
        if(count && paper/count>.25 && colored/count<.015) img.classList.add('paper-white');
      } catch (_) { /* Cross-origin images remain usable in their original form. */ }
    }
    if(img.complete) check();
    else img.addEventListener('load',check,{once:true});
  }
  function scan(root){
    if(root.nodeType!==1 && root.nodeType!==9) return;
    if(root.matches?.(selector)) process(root);
    root.querySelectorAll(selector).forEach(process);
  }
  scan(document);
  new MutationObserver(records=>records.forEach(record=>{
    if(record.type==='attributes') scan(record.target);
    else record.addedNodes.forEach(scan);
  })).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
}
window.installPaperImageCleanup = installPaperImageCleanup;
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',installPaperImageCleanup,{once:true});
else installPaperImageCleanup();

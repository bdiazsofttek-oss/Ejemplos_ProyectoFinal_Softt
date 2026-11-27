const e = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function sourcePanel(state, request, path) {
  const source = await request(path + '/vision/source'); state.source = source;
  return '<section class="panel source-panel"><h2>Fuente de video</h2><form id="source-form" class="form-grid"><label>Tipo<select name="kind">' + [['frames','Fotogramas de simulacion.1'],['file','Video local'],['camera','Cámara IP']].map(([value,label]) => '<option value="' + value + '"' + (value === source.kind ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label><label>Nombre<input name="label" value="' + e(source.label) + '"></label><label>URL de cámara (HTTP, HTTPS o RTSP)<input name="url" value="' + e(source.url) + '" placeholder="rtsp://camara/stream"></label><label>Abrir video local<input id="local-file" type="file" accept="video/*"></label><button>Guardar fuente</button></form><p id="source-status">El video local se reproduce en tu navegador y no se sube al servidor. HTTP/MJPEG puede previsualizarse; RTSP requiere el adaptador de visión pendiente.</p></section>';
}
export function initSource(state, request, path, toast) {
  const scene = document.querySelector('.vision-scene'); const image = document.querySelector('#frame-image');
  const video = document.createElement('video'); video.id = 'local-video'; video.controls = true; video.hidden = true; video.style.width = '100%'; scene.insertBefore(video, scene.firstChild);
  const preview = source => { if (source.kind === 'camera' && /^https?:/.test(source.url)) { video.hidden = true; image.hidden = false; image.src = source.url; } };
  preview(state.source);
  const form = document.querySelector('#source-form');
  form.onsubmit = async event => { event.preventDefault(); event.stopPropagation(); try { const input = Object.fromEntries(new FormData(form)); await request(path + '/vision/source',{method:'PUT',body:JSON.stringify(input)}); state.source = input; preview(input); toast('Fuente guardada. La inferencia continúa en modo demo.'); } catch(error) { toast(error.message,true); } };
  document.querySelector('#local-file').onchange = event => {
    const file = event.target.files[0]; if (!file) return;
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = URL.createObjectURL(file); video.src = state.videoUrl; video.hidden = false; image.hidden = true;
    form.elements.kind.value = 'file'; form.elements.label.value = file.name;
  };
}

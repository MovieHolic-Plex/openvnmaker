import { useEffect, useRef, useState } from "react";
import { resolveRuntimeAsset } from "../storage/runtimeBase.js";
interface Props { src:string; alt:string; chromaKey?:string|undefined; className?:string; testId?:string; title?:string; }
let compositor: { canvas: HTMLCanvasElement; gl: WebGLRenderingContext } | undefined;
function getCompositor() {
  if (compositor && !compositor.gl.isContextLost()) return compositor;
  const canvas=document.createElement("canvas");
  const gl=canvas.getContext("webgl",{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});
  if(!gl) throw new Error("WebGL compositing unavailable");
  const program=gl.createProgram()!;
  for(const [type,source] of [[gl.VERTEX_SHADER,"attribute vec2 position; varying vec2 uv; void main(){ uv=vec2((position.x+1.0)*.5,1.0-(position.y+1.0)*.5); gl_Position=vec4(position,0.0,1.0); }"],[gl.FRAGMENT_SHADER,"precision mediump float; uniform sampler2D art; varying vec2 uv; void main(){ vec4 c=texture2D(art,uv); float dominance=c.g-max(c.r,c.b); float saturation=(c.g-min(c.r,c.b))/max(c.g,.001); float matte=1.0-smoothstep(.08,.45,dominance)*smoothstep(.25,.65,saturation); c.g-=max(0.0,c.g-max(c.r,c.b))*(1.0-matte); gl_FragColor=vec4(c.rgb,c.a*matte); }"]] as const){
    const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error("Art shader failed");
    gl.attachShader(program,shader);gl.deleteShader(shader);
  }
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error("Art shader failed");gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,"position");gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  compositor={canvas,gl};return compositor;
}
/** Source bitmaps stay unchanged. One shared GPU compositor renders keyed game
 * art into display canvases; thumbnails do not allocate a WebGL context each. */
export function ArtImage({src,alt,chromaKey,className,testId,title}:Props){
  const resolvedSrc=resolveRuntimeAsset(src);
  const canvas=useRef<HTMLCanvasElement>(null);const[failed,setFailed]=useState(false);
  useEffect(()=>{
    if(!chromaKey || !canvas.current)return;
    let alive=true;const node=canvas.current;const image=new Image();
    delete node.dataset["loaded"];
    setFailed(false);
    const draw=()=>{
      if(!alive)return;
      try{
        node.style.aspectRatio=String(image.naturalWidth/image.naturalHeight);
        const cssWidth=node.getBoundingClientRect().width || 400;
        const width=Math.min(image.naturalWidth,Math.max(40,Math.ceil(cssWidth*(window.devicePixelRatio||1))));
        const height=Math.round(width*image.naturalHeight/image.naturalWidth);
        const{canvas:surface,gl}=getCompositor();surface.width=width;surface.height=height;
        gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        node.width=width;node.height=height;const context=node.getContext("2d")!;context.clearRect(0,0,width,height);context.drawImage(surface,0,0);
        node.dataset["loaded"]="true";setFailed(false);
      }catch{setFailed(true);}
    };
    let frame: number | undefined;
    const queueDraw=()=>{
      if(frame!==undefined)return;
      frame=requestAnimationFrame(()=>{frame=undefined;if(image.complete&&image.naturalWidth)draw();});
    };
    image.onload=queueDraw;image.onerror=()=>{if(alive)setFailed(true);};image.src=resolvedSrc;
    // Canvas dimensions affect layout; write them outside ResizeObserver delivery.
    const observer=new ResizeObserver(queueDraw);observer.observe(node);
    return()=>{alive=false;observer.disconnect();if(frame!==undefined)cancelAnimationFrame(frame);};
  },[resolvedSrc,chromaKey]);
  if(!chromaKey)return <img src={resolvedSrc} alt={alt} className={className} data-testid={testId} title={title} loading="lazy"/>;
  return <canvas ref={canvas} className={className} data-testid={testId} data-src={resolvedSrc} data-art-error={failed||undefined} role="img" aria-label={alt||"캐릭터 원화"} title={failed?"원화를 표시하지 못했습니다.":title}/>;
}

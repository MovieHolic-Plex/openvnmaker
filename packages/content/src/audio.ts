/** Project audio URLs always identify original bytes, never arbitrary remote code or paths. */
export const validAudioUrl=(value:unknown):value is string=>typeof value==="string"&&/^\/assets\/user\/[a-f0-9]{64}\.(mp3|ogg|wav)$/.test(value);
export const audioPath=(value:string,kind:"bgm"|"sfx")=>validAudioUrl(value)?value:`/assets/audio/${kind}/${value}.mp3`;

export function audioFormat(bytes:Uint8Array):{extension:"mp3"|"ogg"|"wav";mime:string}{
  const text=(start:number,end:number)=>new TextDecoder().decode(bytes.subarray(start,end));
  if(bytes.length>12&&text(0,4)==="RIFF"&&text(8,12)==="WAVE"){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let format=false,data=false;
    for(let offset=12;offset+8<=bytes.length;){
      const size=view.getUint32(offset+4,true);if(offset+8+size>bytes.length)throw new Error("잘린 WAV 파일입니다.");
      if(text(offset,offset+4)==="fmt "){
        if(size<16||view.getUint16(offset+8,true)!==1||view.getUint16(offset+22,true)!==16)throw new Error("WAV는 16비트 PCM 형식이어야 합니다.");
        format=true;
      }
      if(text(offset,offset+4)==="data"&&size>0)data=true;
      offset+=8+size+(size%2);
    }
    if(!format||!data)throw new Error("WAV의 음성 데이터가 없습니다.");
    return {extension:"wav",mime:"audio/wav"};
  }
  if(bytes.length>32&&text(0,4)==="OggS"){
    const start=27+bytes[26]!;
    if(text(start,start+8)!=="OpusHead"&&!(bytes[start]===1&&text(start+1,start+7)==="vorbis"))throw new Error("Ogg는 Vorbis 또는 Opus 오디오여야 합니다.");
    return {extension:"ogg",mime:"audio/ogg"};
  }
  if(bytes.length>3&&(text(0,3)==="ID3"||bytes[0]===255&&(bytes[1]!&0xe0)===0xe0))return {extension:"mp3",mime:"audio/mpeg"};
  throw new Error("MP3, Ogg 또는 16비트 PCM WAV 파일을 선택하세요.");
}

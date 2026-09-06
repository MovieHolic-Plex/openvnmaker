import {parseScript} from "@vnmaker/content";
export const framingStory=parseScript({title:"카메라와 CG 검증",subtitle:"",start:"s",characters:[{id:"d",name:"도현",bio:"",color:"#b5d8eb",chromaKey:"#00ff00",expressionImages:{neutral:"/assets/art/dohyun-neutral.png"}},{id:"s",name:"서린",bio:"",color:"#efbaca",chromaKey:"#00ff00",expressionImages:{neutral:"/assets/art/seorin-neutral.png"}}],scenes:[{id:"s",background:"title",backgroundUrl:"/assets/art/atelier-golden-hour.png",sprites:[{slot:"left",character:"d"},{slot:"right",character:"s"}],lines:[
  {speaker:"d",text:"일반 화면입니다.",framing:"wide"},
  {speaker:"s",text:"시네마틱 띠가 나타납니다.",framing:"cinematic"},
  {speaker:"d",text:"띠가 사라지고 배경이 가까워집니다.",framing:"close"},
  {speaker:null,text:"이벤트 원화를 보여줍니다.",cgUrl:"/assets/art/blue-pigment-cg.png"},
  {speaker:null,text:"세로 원화도 자르지 않고 보여줍니다.",cgUrl:"/assets/art/dohyun-working.png"},
  {speaker:"s",text:"원화를 닫고 배우와 가까운 배경으로 돌아갑니다.",cgUrl:null},
  {speaker:"d",text:"일반 화면으로 돌아왔습니다.",framing:"wide"}
],ending:"연출 검증 완료"}]});

import type {VnScript} from "@vnmaker/content";
export const story:VnScript={title:"상태 분기",subtitle:"",start:"start",characters:[],flags:{trust:0,route:"none",letter:false},scenes:[
  {id:"start",background:"title",lines:[{speaker:null,text:"시작"}],choices:[{text:"신뢰한다",next:"gate",set:{trust:3,route:"ally",letter:true}},{text:"돌아선다",next:"gate"}]},
  {id:"gate",background:"title",lines:[{speaker:null,text:"기억한 편지",when:{all:["letter"],compare:[{flag:"trust",op:"gte",value:3}]}},{speaker:null,text:"갈림길"}],choices:[{text:"비밀을 듣는다",next:"secret",when:{compare:[{flag:"trust",op:"gte",value:3},{flag:"route",op:"eq",value:"ally"}]}},{text:"떠난다",next:"end"}]},
  {id:"secret",background:"title",lines:[{speaker:null,text:"비밀"}],ending:"신뢰의 끝"},
  {id:"end",background:"title",lines:[{speaker:null,text:"닫힌 문"}],ending:"다른 끝"}
]};

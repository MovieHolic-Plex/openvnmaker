import type {VnScript} from "@vnmaker/content";
export const arithmeticStory:VnScript={title:"누적 신뢰 검증",subtitle:"",start:"start",characters:[],flags:{trust:2},scenes:[
  {id:"start",background:"title",lines:[{speaker:null,text:"처음 신뢰는 둘입니다."}],choices:[{text:"함께 돕는다",next:"cost",add:{trust:3}},{text:"외면한다",next:"cost",add:{trust:-1}}]},
  {id:"cost",background:"title",lines:[{speaker:null,text:"결과를 감수할 차례입니다."}],choices:[{text:"위험을 감수한다",next:"gate",add:{trust:-2}}]},
  {id:"gate",background:"title",lines:[{speaker:null,text:"누적된 선택으로 길이 열립니다."}],choices:[{text:"비밀을 듣는다",next:"secret",when:{compare:[{flag:"trust",op:"gte",value:3}]}},{text:"떠난다",next:"ordinary"}]},
  {id:"secret",background:"title",lines:[{speaker:null,text:"신뢰가 남긴 비밀입니다."}],ending:"신뢰의 끝"},
  {id:"ordinary",background:"title",lines:[{speaker:null,text:"다른 길로 걸어갑니다."}],ending:"다른 끝"}
]};

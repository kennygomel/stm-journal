#!/usr/bin/env python3
"""Генерирует dist/preview.html — локальный предпросмотр Mini App без Telegram.

Заглушка Telegram.WebApp + Serverless.callAsync с тестовыми данными, чтобы
отрендерить реальный прод-бандл в браузере и глазами проверить вёрстку.

    python3 tools/preview.py   # после npm run build
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
ASSETS = os.path.join(DIST, "assets")

js = [f for f in os.listdir(ASSETS) if f.endswith(".js")][0]
css = [f for f in os.listdir(ASSETS) if f.endswith(".css")][0]

HTML = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>preview</title>
<link rel="stylesheet" href="/assets/__CSS__" />
<script>
const RATES = {baseRate:250000,pointsFree:12,pointRate:200,kmFree:400,kmRate:20,hoursFree:12,hourRate:2000};
const GLOBAL = {baseRate:12000,pointsFree:12,pointRate:200,kmFree:400,kmRate:20,hoursFree:12,hourRate:2000};
const store = {
  customers:[{id:1,name:'СТМ-Логистика',active:true,baseRate:250000,ownBaseRate:250000,globalBaseRate:12000},
             {id:2,name:'Евротранс',active:true,baseRate:12000,ownBaseRate:null,globalBaseRate:12000}],
  trips:[{id:1,date:'2026-10-05',customerId:1,customerName:'СТМ-Логистика',points:15,distance:500,hours:14,income:254600,rates:RATES}],
  users:[{id:4,tgId:323173181,name:'Ignat',username:'owner',status:'approved',isAdmin:true,isOwner:true},
         {id:5,tgId:555,name:'Новый',username:null,status:'pending',isAdmin:false,isOwner:false}],
};
const me = {user:{id:4,tgId:323173181,name:'Ignat',username:'owner',isAdmin:true,isOwner:true,theme:null,permissions:{journal:true,customers:true,tariffs:true,users:true}},settings:GLOBAL,customers:store.customers,today:'2026-10-11'};
const handlers = {
  me: async()=>me,
  listTrips: async()=>({range:{},trips:store.trips}),
  report: async()=>({from:'2026-10-01',to:'2026-10-31',totals:{trips:1,income:254600,points:15,distance:500,hours:14,extraPoints:3,extraKm:100,extraHours:2,avgIncome:256600},byCustomer:[{customerId:1,customerName:'СТМ-Логистика',trips:1,points:15,distance:500,hours:14,income:254600}],byDate:[{date:'2026-10-05',trips:1,income:254600,points:15,distance:500,hours:14}],today:'2026-10-11'}),
  adminCustomers: async()=>({customers:store.customers,settings:GLOBAL}),
  adminRates: async()=>({settings:GLOBAL}),
  adminUsers: async()=>({users:store.users}),
  saveTheme: async()=>({}),
};
window.Telegram = { WebApp: {
  initData:'query_id=preview', initDataUnsafe:{user:{id:323173181,first_name:'Ignat',username:'owner'}},
  themeParams:{}, ready(){}, expand(){}, close(){}, disableVerticalSwipes(){},
  setHeaderColor(){}, setBackgroundColor(){}, onEvent(){}, showConfirm(m,cb){cb(true)}, showAlert(){}, showPopup(p,cb){cb(null)},
  HapticFeedback:{impactOccurred(){},notificationOccurred(){}},
  BackButton:{show(){},hide(){},onClick(){},offClick(){}},
  Serverless:{ callAsync(name,payload){ return (handlers[name]||(async()=>({})))(payload); } },
} };
</script>
</head>
<body>
<div id="app"><div class="boot">Загрузка…</div></div>
<div id="toast" class="toast" hidden></div>
<script type="module" src="/assets/__JS__"></script>
</body>
</html>
"""

out = HTML.replace("__CSS__", css).replace("__JS__", js)
with open(os.path.join(DIST, "preview.html"), "w") as fh:
    fh.write(out)
print(f"dist/preview.html written ({js}, {css})")

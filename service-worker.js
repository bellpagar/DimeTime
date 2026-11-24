self.addEventListener('push',event=>{
  let message={};
  try{message=event.data?.json()||{};}catch{message={body:event.data?.text()||''};}
  const title=message.title||'DimeTime reminder';
  const options={body:message.body||'You have a reminder.',icon:'favicon.svg',badge:'favicon.svg',tag:message.tag||'dimetime-reminder',renotify:false,data:{url:message.url||'./'}};
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'./',self.location.href).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
    for(const client of windows){if(new URL(client.url).origin===self.location.origin){client.focus();return client.navigate(target);}}
    return clients.openWindow(target);
  }));
});


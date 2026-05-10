document.getElementById('open').onclick = () => chrome.runtime.sendMessage({type:'OPEN_DASHBOARD'});

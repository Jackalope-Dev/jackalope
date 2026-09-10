import {applyThemeTokens, DEFAULT_THEME} from '@jackalope/brand/theme';
import React from 'react';
import {createRoot} from 'react-dom/client';
import './src/index.css';
import {SystemInfoView} from './src/components/settings/SystemInfo';
(window as any).fixtureTheme=(dark:boolean)=>applyThemeTokens({...DEFAULT_THEME, isDark: dark, appearance: 'manual'});
(window as any).fixtureTheme(false);
let requests=0;
(window as any).__TAURI_INTERNALS__={invoke:async(command:string)=>{
 if(command==='system_get_info')return {os:'macos',arch:'aarch64',device_name:'Platform test Mac',git_available:true,desktop_control:{available:false,can_request_permissions:true,message:'Allow Accessibility, Screen Recording and Input Monitoring for Jackalope in System Settings, then restart the app and refresh this device.'}};
 if(command==='desktop_control_request_permissions'){requests++; await new Promise(r=>setTimeout(r,100)); return {available:false,can_request_permissions:true,message:'Permissions are still off. Complete the prompts in System Settings, then restart Jackalope.'};}
 throw new Error(command);
}};
(window as any).permissionRequestCount=()=>requests;
createRoot(document.getElementById('root')!).render(<main style={{padding:32}}><p className="task-muted mb-6">Browser state only; no native permission requests or tasks launched.</p><SystemInfoView/></main>);

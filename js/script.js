import { distance } from './utils.js';

// DOM Elements
const video = document.createElement('video');
video.setAttribute('autoplay', '');
video.setAttribute('muted', '');
video.setAttribute('playsinline', '');
video.style.display = 'none';
document.body.appendChild(video);

const canvas = document.getElementById('canvasOutput');
const ctx = canvas.getContext('2d');
const placeholderImg = document.getElementById('placeholderImg');

const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');

const eyeCountEl = document.getElementById('eye-count');
const eyebrowCountEl = document.getElementById('eyebrow-count');
const mouthCountEl = document.getElementById('mouth-count');
const errorMessage = document.getElementById('errorMessage');

let camera = null;

// Contadores y flags
let eyeCount = 0, eyebrowCount = 0, mouthCount = 0;
let blinkCooldown=false, browCooldown=false, mouthOpen=false, browUp=false;

// Historiales y calibración
let earHistory=[], browHistory=[], mouthHistory=[];
const EAR_HISTORY_LEN=5, BROW_HISTORY_LEN=4, MOUTH_HISTORY_LEN=3;
let baselineEAR=null, browBaseline=null, calibrationCount=0, calibrationFrames=30;

// Funciones para calcular métricas (EAR, boca, cejas)
function getEAR(landmarks, left=true){
    const p = left ? [33,160,158,133,153,144] : [362,385,387,263,373,380];
    const A = distance(landmarks[p[1]], landmarks[p[5]]);
    const B = distance(landmarks[p[2]], landmarks[p[4]]);
    const C = distance(landmarks[p[0]], landmarks[p[3]]);
    return (A+B)/(2*C);
}
function getEARSmooth(landmarks){
    const avg = (getEAR(landmarks,true)+getEAR(landmarks,false))/2;
    earHistory.push(avg);
    if(earHistory.length>EAR_HISTORY_LEN) earHistory.shift();
    return earHistory.reduce((a,b)=>a+b,0)/earHistory.length;
}
function getMouthOpennessSmooth(landmarks){
    const ratio = distance(landmarks[13], landmarks[14])/distance(landmarks[78], landmarks[308]);
    mouthHistory.push(ratio);
    if(mouthHistory.length>MOUTH_HISTORY_LEN) mouthHistory.shift();
    return mouthHistory.reduce((a,b)=>a+b,0)/mouthHistory.length;
}
function getBrowMovementSmooth(landmarks){
    const leftBrow=[70,63,105], rightBrow=[300,293,334];
    const leftEye=[159,145], rightEye=[386,374];
    const leftBrowY = leftBrow.reduce((sum,i)=>sum+landmarks[i].y,0)/leftBrow.length;
    const rightBrowY = rightBrow.reduce((sum,i)=>sum+landmarks[i].y,0)/rightBrow.length;
    const leftEyeY = leftEye.reduce((sum,i)=>sum+landmarks[i].y,0)/leftEye.length;
    const rightEyeY = rightEye.reduce((sum,i)=>sum+landmarks[i].y,0)/rightEye.length;

    let browHeight = ((leftEyeY-leftBrowY)+(rightEyeY-rightBrowY))/2;
    const eyeDist = distance(landmarks[leftEye[0]], landmarks[rightEye[0]]);
    browHeight /= eyeDist;

    if(calibrationCount<calibrationFrames){
        if(!browBaseline) browBaseline=browHeight;
        browBaseline = (browBaseline*calibrationCount + browHeight)/(calibrationCount+1);
    }

    browHistory.push(browHeight);
    if(browHistory.length>BROW_HISTORY_LEN) browHistory.shift();
    const avgBrow = browHistory.reduce((a,b)=>a+b,0)/browHistory.length;
    return avgBrow - browBaseline;
}

// MediaPipe results
function onResults(results){
    if(!results.multiFaceLandmarks || results.multiFaceLandmarks.length===0) return;
    const landmarks = results.multiFaceLandmarks[0];

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(results.image,0,0,canvas.width,canvas.height);

    drawConnectors(ctx, landmarks, FACEMESH_TESSELATION, {color:'#C0C0C030', lineWidth:1});
    drawConnectors(ctx, landmarks, FACEMESH_LEFT_EYE, {color:'#0ba50bff'});
    drawConnectors(ctx, landmarks, FACEMESH_RIGHT_EYE, {color:'#0ba50bff'});
    drawConnectors(ctx, landmarks, FACEMESH_LIPS, {color:'#8b0f62ff'});
    drawConnectors(ctx, landmarks, FACEMESH_LEFT_EYEBROW, {color:'#ec4e05ff'});
    drawConnectors(ctx, landmarks, FACEMESH_RIGHT_EYEBROW, {color:'#ec4e05ff'});

    // Parpadeos
    const earSmooth = getEARSmooth(landmarks);
    if(calibrationCount<calibrationFrames){
        if(!baselineEAR) baselineEAR = earSmooth;
        baselineEAR = (baselineEAR*calibrationCount + earSmooth)/(calibrationCount+1);
        calibrationCount++;
    }
    if(baselineEAR && earSmooth<baselineEAR*0.7 && !blinkCooldown){
        eyeCount++; eyeCountEl.textContent=eyeCount;
        blinkCooldown=true; setTimeout(()=>blinkCooldown=false,250);
    }

    // Cejas
    const browMove = getBrowMovementSmooth(landmarks);
    const browThreshold = 0.015;
    if(calibrationCount>=calibrationFrames){
        if(browMove>browThreshold && !browUp && !browCooldown){
            eyebrowCount++; eyebrowCountEl.textContent=eyebrowCount;
            browUp=true; browCooldown=true;
            setTimeout(()=>browCooldown=false,300);
        } else if(browMove<browThreshold*0.5 && browUp){
            browUp=false;
        }
    }

    // Boca
    const mouthSmooth = getMouthOpennessSmooth(landmarks);
    if(mouthSmooth>0.32 && !mouthOpen){ mouthCount++; mouthOpen=true; mouthCountEl.textContent=mouthCount; }
    else if(mouthSmooth<=0.28 && mouthOpen){ mouthOpen=false; }
}

// Botones
btnStart.addEventListener('click', async ()=>{
    try{
        placeholderImg.style.display='none';
        canvas.style.display='block';

        const faceMesh = new FaceMesh({locateFile:(file)=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
        faceMesh.setOptions({ maxNumFaces:1, refineLandmarks:true, minDetectionConfidence:0.5, minTrackingConfidence:0.5 });
        faceMesh.onResults(onResults);

        camera = new Camera(video, { onFrame: async()=>{ await faceMesh.send({image:video}); }, width:640, height:480 });
        camera.start();
    } catch(err){ errorMessage.textContent='Error iniciando cámara: '+err; }
});

btnStop.addEventListener('click', ()=>{
    if(camera) camera.stop();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    placeholderImg.style.display='block';
});

const btnReset = document.getElementById('btnReset');

btnReset.addEventListener('click', ()=>{
    // Detener cámara si está activa
    if(camera) camera.stop();

    // Limpiar canvas
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // Reiniciar contadores
    eyeCount = 0;
    eyebrowCount = 0;
    mouthCount = 0;
    eyeCountEl.textContent = '0';
    eyebrowCountEl.textContent = '0';
    mouthCountEl.textContent = '0';

    // Reiniciar flags y calibración
    blinkCooldown = false;
    browCooldown = false;
    mouthOpen = false;
    browUp = false;
    earHistory = [];
    browHistory = [];
    mouthHistory = [];
    baselineEAR = null;
    browBaseline = null;
    calibrationCount = 0;

    // Mostrar placeholder de nuevo
    placeholderImg.style.display = 'block';
    canvas.style.display = 'block';
    errorMessage.textContent = '';
});

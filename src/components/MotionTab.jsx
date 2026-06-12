import React, { useState } from 'react'
import { callAI, fileToBase64 } from '../utils/gemini'

const CAM_MOVES = ['Static','Dolly In','Dolly Out','Pan Left→Right','Pan Right→Left','Tilt Up','Tilt Down','Orbital 360°','Handheld','Crane Up','Aerial Drone']
const TRANSITIONS = ['Cut','Dissolve','Wipe','Morph','Zoom Transition','Glitch']
const SPEED_LABELS = ['Very Slow','Slow','Medium','Fast','Ultra Fast']
const CUT_LABELS = ['Slow','Normal','Fast','Ultra Fast']

export default function MotionTab({ state, set, showToast }) {
  const [params, setParams] = useState({
    camSpeed: 3, motBlur: 0.5, panInt: 0.3, zoomRate: 0, shake: 0,
    camMove: 'Static', cutFreq: 2, transition: 'Cut'
  })
  const [output, setOutput] = useState('')
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const setP = (k,v) => setParams(p => ({...p,[k]:v}))

  async function generateMotionPrompt() {
    if (!state.apiKey) return showToast('Enter your API key!', true)
    setLoading(true)
    setOutput('Generating motion prompt...')
    const prompt = `Generate a precise motion video prompt based on these parameters:
Camera Movement: ${params.camMove}
Camera Speed: ${SPEED_LABELS[params.camSpeed-1]}
Motion Blur: ${params.motBlur}
Pan Intensity: ${params.panInt}
Zoom Rate: ${params.zoomRate}
Camera Shake: ${params.shake}
Cut Frequency: ${CUT_LABELS[params.cutFreq-1]}
Transition: ${params.transition}
${state.analysisData?.mainPrompt ? 'Video context: ' + state.analysisData.mainPrompt : ''}

Write a detailed motion-focused video prompt with precise cinematic terminology. Include specific values and technical details.
Also provide 6-8 motion descriptor tags.

Format EXACTLY:
MOTION PROMPT: [detailed prompt here]
TAGS: [tag1], [tag2], [tag3], [tag4], [tag5], [tag6]`
    try {
      const { text, tokens } = await callAI({ provider: state.provider, apiKey: state.apiKey, model: state.model, prompt, temperature: parseFloat(state.temperature), maxTokens: 1024 })
      const parts = text.split('TAGS:')
      setOutput(parts[0].replace('MOTION PROMPT:', '').trim())
      if (parts[1]) setTags(parts[1].trim().split(',').map(t => t.trim()).filter(Boolean))
      set(prev => ({ totalTokens: prev.totalTokens + tokens }))
      showToast('Motion prompt generated!')
    } catch(e) { showToast('Error: ' + e.message, true); setOutput('') }
    setLoading(false)
  }

  async function analyzeFromVideo() {
    if (!state.videoFile) return showToast('Upload a video first!', true)
    if (!state.apiKey) return showToast('Enter your API key!', true)
    setLoading(true)
    setOutput('Detecting motion from video...')
    try {
      const b64 = await fileToBase64(state.videoFile)
      const { text, tokens } = await callAI({ provider: state.provider,
        apiKey: state.apiKey, model: state.model,
        prompt: `Analyze the motion in this video. Extract: camera movement type, motion speed, pan/tilt/zoom, shake/stabilization, cut frequency, transition style. Output a detailed MOTION PROMPT then TAGS.`,
        mediaData: b64, mimeType: state.videoFile.type || 'video/mp4',
        temperature: parseFloat(state.temperature), maxTokens: 1024
      })
      const parts = text.split('TAGS:')
      setOutput(parts[0].replace('MOTION PROMPT:', '').trim())
      if (parts[1]) setTags(parts[1].trim().split(',').map(t => t.trim()).filter(Boolean))
      set(prev => ({ totalTokens: prev.totalTokens + tokens }))
      showToast('Motion detected!')
    } catch(e) { showToast('Error: ' + e.message, true); setOutput('') }
    setLoading(false)
  }

  function copyOutput() {
    if (!output) return
    navigator.clipboard.writeText(output).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); showToast('Copied!') })
  }

  return (
    <div style={{display:'flex',gap:14,width:'100%'}}>
      <div style={{width:300,minWidth:300,display:'flex',flexDirection:'column',gap:12}}>
        <Card title="Motion Parameters" dotColor="var(--accent4)">
          <Slider label="Camera Speed" value={params.camSpeed} min={1} max={5} step={1} display={v => SPEED_LABELS[v-1]} onChange={v => setP('camSpeed',+v)} />
          <Slider label="Motion Blur" value={params.motBlur} min={0} max={1} step={0.1} display={v=>v} onChange={v => setP('camSpeed', parseFloat(v)) || setP('motBlur',parseFloat(v))} />
          <Slider label="Pan Intensity" value={params.panInt} min={0} max={1} step={0.1} display={v=>v} onChange={v => setP('panInt',parseFloat(v))} />
          <Slider label="Zoom Rate" value={params.zoomRate} min={0} max={1} step={0.1} display={v=>v} onChange={v => setP('zoomRate',parseFloat(v))} />
          <Slider label="Camera Shake" value={params.shake} min={0} max={1} step={0.1} display={v=>v} onChange={v => setP('shake',parseFloat(v))} />
          <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:5,marginTop:4}}>Camera Move Type</div>
          <SelectSmall value={params.camMove} onChange={v => setP('camMove',v)} options={CAM_MOVES.map(m => ({value:m,label:m}))} />
        </Card>
        <Card title="Timing & Rhythm" dotColor="var(--accent)">
          <Slider label="Cut Frequency" value={params.cutFreq} min={1} max={4} step={1} display={v => CUT_LABELS[v-1]} onChange={v => setP('cutFreq',+v)} />
          <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:5,marginTop:4}}>Transition Style</div>
          <SelectSmall value={params.transition} onChange={v => setP('transition',v)} options={TRANSITIONS.map(t => ({value:t,label:t}))} />
          <button onClick={generateMotionPrompt} disabled={loading} style={{width:'100%',padding:'9px',marginTop:10,fontSize:11,fontWeight:700,fontFamily:'var(--mono)',letterSpacing:'0.07em',background:'var(--accent4)',border:'none',color:'#1a1200',borderRadius:6,cursor:'pointer',transition:'all 0.2s',opacity:loading?0.5:1}}>
            {loading ? '⟳ Generating...' : '🎬 Generate Motion Prompt'}
          </button>
        </Card>
      </div>
      <div style={{flex:1,display:'flex',flexDirection:'column',gap:12}}>
        <Card title="Motion Prompt Output" dotColor="var(--accent4)">
          <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:6,padding:11,minHeight:180,fontSize:12,lineHeight:1.7,color:output?'var(--text2)':'var(--text3)',fontStyle:output?'normal':'italic',whiteSpace:'pre-wrap',wordBreak:'break-word',animation:loading?'pulse 1.1s infinite':'none'}}>
            {output || 'Configure motion parameters and click Generate Motion Prompt.'}
          </div>
          <div style={{display:'flex',gap:6,marginTop:8}}>
            <Btn copied={copied} onClick={copyOutput}>📋 Copy</Btn>
            <Btn onClick={analyzeFromVideo}>🔍 Analyze from Video</Btn>
          </div>
          {tags.length > 0 && (
            <div style={{marginTop:12}}>
              <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>Motion Tags</div>
              <div>{tags.map((t,i) => <span key={i} style={{display:'inline-block',background:'var(--surface3)',border:'1px solid var(--border2)',borderRadius:4,padding:'2px 7px',fontSize:10,fontFamily:'var(--mono)',color:'var(--accent3)',margin:'2px'}}>{t}</span>)}</div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Card({ title, dotColor, children }) {
  return (
    <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,padding:14}}>
      <div style={{fontSize:10,fontWeight:600,letterSpacing:'0.1em',color:'var(--text3)',textTransform:'uppercase',marginBottom:12,display:'flex',alignItems:'center',gap:6}}>
        <span style={{width:6,height:6,borderRadius:'50%',background:dotColor,flexShrink:0,display:'inline-block'}} />
        {title}
      </div>
      {children}
    </div>
  )
}

function Slider({ label, value, min, max, step, display, onChange }) {
  return (
    <div style={{marginBottom:11}}>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--text2)',marginBottom:4}}>
        <span>{label}</span>
        <span style={{color:'var(--accent)',fontFamily:'var(--mono)',fontSize:11}}>{display(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(e.target.value)} style={{width:'100%',accentColor:'var(--accent)'}} />
    </div>
  )
}

function SelectSmall({ value, onChange, options }) {
  return (
    <div style={{position:'relative'}}>
      <select defaultValue={value} onChange={e => onChange(e.target.value)} style={{width:'100%',background:'var(--surface2)',border:'1px solid var(--border2)',color:'var(--text)',fontSize:11,fontFamily:'var(--mono)',padding:'6px 24px 6px 8px',borderRadius:6,appearance:'none',outline:'none'}}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span style={{position:'absolute',right:7,top:'50%',transform:'translateY(-50%)',color:'var(--text3)',pointerEvents:'none',fontSize:10}}>▼</span>
    </div>
  )
}

function Btn({ children, onClick, copied }) {
  return (
    <button onClick={onClick} style={{flex:1,padding:'6px 8px',fontSize:10,fontFamily:'var(--mono)',background:copied?'rgba(45,232,176,0.1)':'var(--surface2)',border:`1px solid ${copied?'var(--accent3)':'var(--border2)'}`,color:copied?'var(--accent3)':'var(--text2)',borderRadius:6,cursor:'pointer',transition:'all 0.2s'}}>
      {copied ? '✓ Copied!' : children}
    </button>
  )
}

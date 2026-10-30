'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { get, set, del } from 'idb-keyval';

interface Project {
  id: string;
  name: string;
  count: number;
  rulerTop: number;
  rulerHeight: number;
  stepSize: number;
  direction: 'down' | 'up';
  updatedAt: number;
}

export default function CounterApp() {
  const [mounted, setMounted] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isWorkerReady, setIsWorkerReady] = useState(false); // 워커 준비 완료 여부
  const [errorMsg, setErrorMsg] = useState<string>('');

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [count, setCount] = useState<number>(1);
  const [rulerTop, setRulerTop] = useState<number>(100);
  const [rulerHeight, setRulerHeight] = useState<number>(28);
  const [stepSize, setStepSize] = useState<number>(28);
  const [direction, setDirection] = useState<'down' | 'up'>('down');
  
  const [isRulerEnabled, setIsRulerEnabled] = useState(true);
  const [syncHeightAndStep, setSyncHeightAndStep] = useState(true);
  const [showRulerSettings, setShowRulerSettings] = useState(false);
  
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [numPages, setNumPages] = useState<number>(1);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [pageWidth, setPageWidth] = useState<number>(360);

  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  const wakeLockRef = useRef<any>(null);

  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const startTopRef = useRef(0);

  // 1. 사파리 전용 안전 워커 로더 (외부 URL을 내부 Blob으로 변환하여 보안 차단 회피)
  useEffect(() => {
    let active = true;

    const initWorker = async () => {
      try {
        const version = pdfjs.version;
        // unpkg에서 스크립트를 텍스트로 가져와 내부 Blob으로 생성 (Same-Origin 우회)
        let res = await fetch(`https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`);
        if (!res.ok) {
          res = await fetch(`https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.js`);
        }
        
        const scriptText = await res.text();
        const blob = new Blob([scriptText], { type: 'application/javascript' });
        const workerBlobUrl = URL.createObjectURL(blob);

        if (active) {
          pdfjs.GlobalWorkerOptions.workerSrc = workerBlobUrl;
          setIsWorkerReady(true);
        }
      } catch (err: any) {
        console.warn('내부 워커 변환 실패, 기본 URL 시도:', err);
        if (active) {
          pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
          setIsWorkerReady(true);
        }
      }
    };

    initWorker();
    return () => { active = false; };
  }, []);

  // 화면 너비 감지
  useEffect(() => {
    const updateWidth = () => {
      setPageWidth(Math.min(window.innerWidth - 32, 600));
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // 2. 초기 로드
  useEffect(() => {
    const init = async () => {
      try {
        const savedProjects = localStorage.getItem('knittingProjects');
        const savedActiveId = localStorage.getItem('activeProjectId');
        
        let activeProj: Project;
        if (savedProjects) {
          const parsed = JSON.parse(savedProjects) as Project[];
          activeProj = parsed.find(p => p.id === savedActiveId) || parsed[0];
          setProjects(parsed);
        } else {
          activeProj = { 
            id: Date.now().toString(), name: '첫 번째 작품', 
            count: 1, rulerTop: 100, rulerHeight: 28, stepSize: 28, direction: 'down', updatedAt: Date.now() 
          };
          setProjects([activeProj]);
        }
        
        setActiveId(activeProj.id);
        setCount(activeProj.count);
        setRulerTop(activeProj.rulerTop);
        setRulerHeight(activeProj.rulerHeight);
        setStepSize(activeProj.stepSize);
        setDirection(activeProj.direction);

        // 저장된 도안 복구
        await loadPdfFromStorage(activeProj.id);
      } catch (err: any) {
        console.error('설정 로드 오류:', err);
      } finally {
        setMounted(true);
        setIsInitialized(true);
      }
    };
    init();
  }, []);

  // 3. 상태 자동 저장
  useEffect(() => {
    if (!isInitialized || !activeId) return;
    setProjects(prev => {
      const updated = prev.map(p => p.id === activeId ? { ...p, count, rulerTop, rulerHeight, stepSize, direction, updatedAt: Date.now() } : p);
      localStorage.setItem('knittingProjects', JSON.stringify(updated));
      localStorage.setItem('activeProjectId', activeId);
      return updated;
    });
  }, [count, rulerTop, rulerHeight, stepSize, direction, activeId, isInitialized]);

  const loadPdfFromStorage = async (projectId: string) => {
    setIsPdfLoading(true);
    try {
      const storedBuffer = await get(`pdf_buffer_${projectId}`);
      if (storedBuffer) {
        const blob = new Blob([storedBuffer], { type: 'application/pdf' });
        setPdfUrl(URL.createObjectURL(blob));
      }
    } catch (err: any) {
      console.warn('PDF 로드 실패:', err);
    } finally {
      setIsPdfLoading(false);
    }
  };

  const loadProjectState = (p: Project) => {
    setActiveId(p.id);
    setCount(p.count);
    setRulerTop(p.rulerTop);
    setRulerHeight(p.rulerHeight);
    setStepSize(p.stepSize);
    setDirection(p.direction);
    setPageNumber(1);
    setPdfUrl(null);
    loadPdfFromStorage(p.id);
  };

  // iCloud 및 기기 파일 업로드
  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeId) return;

    setErrorMsg('');
    setIsPdfLoading(true);

    try {
      const buffer = await file.arrayBuffer();
      const blob = new Blob([buffer], { type: 'application/pdf' });
      
      setPdfUrl(URL.createObjectURL(blob));
      setPageNumber(1);
      await set(`pdf_buffer_${activeId}`, buffer);
    } catch (err: any) {
      setErrorMsg('도안을 열 수 없습니다: ' + err.message);
    } finally {
      setIsPdfLoading(false);
      event.target.value = '';
    }
  };

  // 🌟 핵심 방어 코드: 에러 발생 시 도안 URL을 즉시 제거하여 무한 깜빡임 루프 차단
  const handleDocumentError = useCallback((err: Error) => {
    console.error('PDF 렌더링 에러:', err);
    setPdfUrl(null); // URL을 비워 재시도 루프 중단
    setErrorMsg('도안을 읽지 못했습니다. 올바른 PDF 형식인지 확인해 주세요.');
  }, []);

  const addNewProject = () => {
    const name = prompt('새 작품의 이름을 입력하세요.', '새 작품');
    if (!name) return;
    const newProj: Project = { id: Date.now().toString(), name, count: 1, rulerTop: 100, rulerHeight: 28, stepSize: 28, direction: 'down', updatedAt: Date.now() };
    setProjects(prev => [...prev, newProj]);
    loadProjectState(newProj);
    setIsDrawerOpen(false);
  };

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (projects.length <= 1) return alert('최소 1개의 작품은 남겨두어야 합니다.');
    if (!confirm('이 작품을 삭제하시겠습니까?')) return;
    
    const updated = projects.filter(p => p.id !== id);
    setProjects(updated);
    if (activeId === id) loadProjectState(updated[0]);

    try {
      await del(`pdf_buffer_${id}`);
    } catch (err) {}
  };

  const toggleWakeLock = async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      if (wakeLockRef.current) { await wakeLockRef.current.release(); wakeLockRef.current = null; setIsWakeLockActive(false); } 
      else { wakeLockRef.current = await navigator.wakeLock.request('screen'); setIsWakeLockActive(true); }
    } catch (err) {}
  };

  const handleCountChange = (delta: number) => {
    setCount((prev) => {
      const nextCount = Math.max(1, prev + delta);
      if (nextCount !== prev) {
        const move = delta * (direction === 'down' ? stepSize : -stepSize);
        setRulerTop((top) => Math.max(0, top + move));
      }
      return nextCount;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); handleCountChange(1); } 
      else if (e.code === 'Backspace') { e.preventDefault(); handleCountChange(-1); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stepSize, direction]);

  const startDrag = (clientY: number) => {
    isDraggingRef.current = true; dragStartYRef.current = clientY; startTopRef.current = rulerTop;
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDraggingRef.current) return;
      const currentY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const deltaY = currentY - dragStartYRef.current;
      setRulerTop(Math.max(0, startTopRef.current + deltaY));
    };
    const onEnd = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove); window.addEventListener('touchend', onEnd);
  };

  if (!mounted) return <div className="min-h-screen bg-stone-100 flex items-center justify-center font-medium">앱 로딩 중...</div>;

  const currentProjectName = projects.find(p => p.id === activeId)?.name || '작품';

  return (
    <main className="flex flex-col lg:flex-row min-h-screen bg-stone-100 text-stone-800 relative">
      
      {errorMsg && (
        <div className="fixed top-0 left-0 right-0 bg-red-600 text-white text-xs p-3 z-50 flex justify-between items-center shadow-lg">
          <span className="font-mono">{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="font-bold px-2 py-0.5 bg-red-800 rounded">닫기</button>
        </div>
      )}

      {/* 📁 프로젝트 서랍 */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsDrawerOpen(false)}></div>
          <div className="relative w-72 bg-stone-50 h-full shadow-2xl flex flex-col">
            <div className="p-5 border-b border-stone-200 bg-white flex justify-between items-center">
              <h2 className="font-bold text-lg text-stone-800">내 작품 보관함 🧶</h2>
              <button onClick={() => setIsDrawerOpen(false)} className="text-2xl text-stone-400 hover:text-stone-700">&times;</button>
            </div>
            <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
              {projects.sort((a,b) => b.updatedAt - a.updatedAt).map(p => (
                <div key={p.id} onClick={() => { loadProjectState(p); setIsDrawerOpen(false); }} className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${p.id === activeId ? 'bg-amber-50 border-amber-400 shadow-sm' : 'bg-white border-transparent shadow-sm hover:border-stone-200'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-bold text-stone-800 line-clamp-1">{p.name}</span>
                    <button onClick={(e) => deleteProject(p.id, e)} className="text-xs text-stone-400 hover:text-red-500 font-medium">삭제</button>
                  </div>
                  <div className="text-sm font-medium text-amber-700">진행: {p.count}단</div>
                </div>
              ))}
            </div>
            <div className="p-4 bg-white border-t border-stone-200">
              <button onClick={addNewProject} className="w-full py-3 bg-stone-800 text-white rounded-xl font-bold hover:bg-stone-900 transition-transform active:scale-95">+ 새 작품 추가하기</button>
            </div>
          </div>
        </div>
      )}

      {/* 왼쪽: 도안 뷰어 */}
      <section className="flex-1 border-r border-stone-300 flex flex-col max-h-[55vh] lg:max-h-screen overflow-hidden">
        <header className="p-3 bg-white border-b border-stone-200 flex flex-wrap items-center gap-2 z-20 shadow-sm">
          <input type="file" accept="application/pdf" onChange={onFileChange} className="text-xs text-stone-600 file:mr-2 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-amber-100 file:text-amber-800 hover:file:bg-amber-200 cursor-pointer" />
          
          {pdfUrl && (
            <div className="flex items-center gap-1.5 ml-auto flex-wrap">
              <div className="flex items-center bg-stone-100 rounded-lg p-0.5 border border-stone-200">
                <button onClick={() => setPageNumber(p => Math.max(1, p - 1))} className="px-2 py-0.5 text-xs font-bold hover:bg-stone-200 rounded">-</button>
                <span className="px-2 text-xs font-medium">{pageNumber} / {numPages}</span>
                <button onClick={() => setPageNumber(p => Math.min(numPages, p + 1))} className="px-2 py-0.5 text-xs font-bold hover:bg-stone-200 rounded">+</button>
              </div>
              <button onClick={() => setIsRulerEnabled(!isRulerEnabled)} className={`text-xs px-2 py-1 rounded-lg font-medium ${isRulerEnabled ? 'bg-amber-600 text-white' : 'bg-stone-200 text-stone-600'}`}>눈금자 {isRulerEnabled ? 'ON' : 'OFF'}</button>
              <button onClick={() => setDirection(d => d === 'down' ? 'up' : 'down')} className="text-xs px-2 py-1 bg-stone-100 border border-stone-200 rounded-lg font-medium">{direction === 'down' ? '⬇️' : '⬆️'}</button>
              <button onClick={() => setShowRulerSettings(!showRulerSettings)} className={`text-xs px-2 py-1 border rounded-lg font-medium ${showRulerSettings ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-700'}`}>⚙️</button>
            </div>
          )}
        </header>

        {pdfUrl && showRulerSettings && (
          <div className="bg-stone-50 border-b border-stone-300 p-3 px-4 z-20 flex flex-wrap gap-4 items-center text-xs text-stone-700">
            <div className="flex items-center gap-2">
              <span className="font-bold">두께:</span>
              <input type="range" min="12" max="90" value={rulerHeight} onChange={(e) => { const v = Number(e.target.value); setRulerHeight(v); if(syncHeightAndStep) setStepSize(v); }} className="w-20 accent-amber-700 cursor-pointer" />
              <span className="font-mono w-8 text-right font-semibold">{rulerHeight}px</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold">이동:</span>
              <input type="range" min="10" max="90" value={stepSize} disabled={syncHeightAndStep} onChange={(e) => setStepSize(Number(e.target.value))} className={`w-20 accent-amber-700 cursor-pointer ${syncHeightAndStep ? 'opacity-40' : ''}`} />
              <span className="font-mono w-8 text-right font-semibold">{stepSize}px</span>
            </div>
            <label className="flex items-center gap-1 cursor-pointer font-medium select-none">
              <input type="checkbox" checked={syncHeightAndStep} onChange={(e) => { setSyncHeightAndStep(e.target.checked); if (e.target.checked) setStepSize(rulerHeight); }} className="rounded accent-amber-700" />
              동기화
            </label>
          </div>
        )}

        <div className="flex-1 overflow-auto bg-stone-200 p-2 sm:p-4 flex justify-center select-none">
          {isPdfLoading || (!isWorkerReady && pdfUrl) ? (
            <div className="mt-20 text-stone-500 font-medium animate-pulse">도안 엔진 준비 중...</div>
          ) : pdfUrl && isWorkerReady ? (
            <div className="relative inline-block max-w-full">
              <Document 
                file={pdfUrl} 
                onLoadSuccess={({ numPages }) => setNumPages(numPages)} 
                onLoadError={handleDocumentError}
                loading={<div className="mt-10 text-stone-500">도안 그리는 중...</div>}
              >
                <Page 
                  pageNumber={pageNumber} 
                  renderTextLayer={false} 
                  renderAnnotationLayer={false} 
                  className="shadow-lg rounded-sm" 
                  width={pageWidth}
                  // 모바일 사파리 캔버스 메모리 폭주 방지 (최대 2x로 캡)
                  devicePixelRatio={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1}
                />
              </Document>
              {isRulerEnabled && (
                <div style={{ top: `${rulerTop}px`, height: `${rulerHeight}px` }} className="absolute left-0 w-full bg-amber-400/35 border-y-2 border-amber-500 transition-[top] duration-150 ease-out flex items-center justify-between px-2">
                  <div onMouseDown={(e) => startDrag(e.clientY)} onTouchStart={(e) => startDrag(e.touches[0].clientY)} className="flex items-center gap-1.5 cursor-grab active:cursor-grabbing bg-amber-200/90 hover:bg-amber-300 text-amber-900 px-2 py-0.5 rounded shadow-sm">
                    <span className="text-xs font-bold leading-none select-none">⠿</span>
                    <span className="text-[11px] font-black tracking-wider leading-none select-none">{count}단</span>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-amber-600 animate-pulse pointer-events-none"></div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-20 text-stone-500 font-medium text-sm">상단에서 PDF 도안을 선택해 주세요.</div>
          )}
        </div>
      </section>

      {/* 오른쪽: 카운터 */}
      <section className="w-full lg:w-[420px] flex flex-col items-center justify-between p-4 sm:p-6 bg-stone-100">
        <header className="w-full flex justify-between items-center py-2 border-b border-stone-300">
          <div className="flex items-center gap-2">
            <button onClick={() => setIsDrawerOpen(true)} className="p-1.5 bg-stone-200 hover:bg-stone-300 rounded-lg transition-colors">
              <svg className="w-5 h-5 text-stone-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </button>
            <h1 className="text-base sm:text-lg font-bold text-stone-800 line-clamp-1 max-w-[140px]">{currentProjectName}</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <button onClick={toggleWakeLock} className={`text-xs px-2.5 py-1.5 rounded-full font-medium transition-colors ${isWakeLockActive ? 'bg-amber-200 text-amber-900' : 'bg-stone-200 text-stone-600'}`}>
              {isWakeLockActive ? '💡 켜짐' : '🌙 끄기'}
            </button>
            <button onClick={() => { setCount(1); setRulerTop(100); }} className="text-xs text-stone-500 underline">초기화</button>
          </div>
        </header>

        <button onClick={() => handleCountChange(1)} className="w-full h-56 lg:h-80 my-auto bg-white rounded-3xl shadow-md border border-stone-200 flex flex-col items-center justify-center cursor-pointer active:scale-95 transition-transform">
          <span className="text-xs sm:text-sm font-medium text-stone-400 mb-2 pointer-events-none">화면 탭 / 스페이스바</span>
          <span className="text-7xl lg:text-8xl font-black text-amber-900 pointer-events-none">{count}</span>
          <span className="text-stone-500 mt-2 font-medium pointer-events-none">단 (Row)</span>
        </button>

        <footer className="w-full flex gap-3 pb-2">
          <button onClick={() => handleCountChange(-1)} className="flex-1 py-3.5 bg-stone-200 text-stone-700 font-bold rounded-2xl active:bg-stone-300 text-base sm:text-lg">- 1단</button>
          <button onClick={() => handleCountChange(1)} className="flex-1 py-3.5 bg-amber-800 text-white font-bold rounded-2xl active:bg-amber-900 shadow-md text-base sm:text-lg">+ 1단</button>
        </footer>
      </section>

    </main>
  );
}
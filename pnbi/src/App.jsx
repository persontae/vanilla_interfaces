import { useRef, useState, useEffect } from 'react';
import './App.css';

function App() {
  // --- State and Refs ---
  const canvasRef = useRef(null);
  const chatInputRef = useRef(null);
  const socketRefs = useRef({});

  // --- Canvas & Toolbar State ---
  const [activeTool, setActiveTool] = useState('mouse');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [startDrag, setStartDrag] = useState({ x: 0, y: 0 });

  // --- REFACTORED: API-Ready State Management ---
  const [assetHistory, setAssetHistory] = useState({});
  const [canvasAssetIds, setCanvasAssetIds] = useState([]);
  
  const [selectedIds, setSelectedIds] = useState([]);
  const [connections, setConnections] = useState([]);
  const [drawingConnection, setDrawingConnection] = useState(null);

  // State for non-asset elements
  const [shapes, setShapes] = useState([]);
  const [drawingRect, setDrawingRect] = useState(null);
  const [textBlocks, setTextBlocks] = useState([]);
  const [draggingTextId, setDraggingTextId] = useState(null);
  const [textDragOffset, setTextDragOffset] = useState({ x: 0, y: 0 });

  // --- Chat State ---
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // --- NEW: MOCK API & CONTEXT HANDLING ---
  const getNodePayload = (node) => {
    if (!node) return null;
    const payload = { id: node.id, type: node.type, content: node.content };

    if (node.type === 'color') { payload.color = node.color; payload.opacity = node.opacity; }
    if (node.type === 'size') { payload.size = node.size; }
    if (node.type === 'mix') {
      payload.inputs = (node.inputs || []).map(input => ({
        nodeId: input.nodeId,
        weight: input.weight
      }));
    }
    // ✅ ADD THIS LOGIC
    if (node.type === 'image' && node.file) {
      // For images, we can indicate that a file has been uploaded
      payload.fileName = "Uploaded Image"; 
    }
    if (node.type === 'ai-output-image' || node.type === 'ai-output-3d') {
      // For AI assets, send the original prompt that created them
      payload.source_prompt = node.source_prompt;
    }

    return payload;
  };

  const mockApiCall = async (payload) => {
    console.log("Sending Inquiry to Mock API:", payload);
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (payload.context_nodes.length > 0) {
      const nodeDescriptions = payload.context_nodes.map(node => {
        let details = '';
        switch (node.type) {
        case 'text':
          details = `contains text: "${(node.content || '').substring(0, 50)}..."`;
          break;
        case 'image':
          details = `contains an '${node.fileName || 'unnamed image'}'`;
          break;
        case 'color':
          details = `is set to ${node.color} at ${node.opacity}% opacity`;
          break;
        case 'size':
          details = `is set to X:${node.size.x || '?'}, Y:${node.size.y || '?'}, Z:${node.size.z || '?'}`;
          break;
        case 'mix':
          const inputDetails = (node.inputs || []).map(input =>
            `  - Mixes Node #${Math.floor(input.nodeId)} with a weight of ${input.weight}%`
          ).join('\n');
          details = `mixes ${node.inputs.length} nodes:\n${inputDetails}`;
          break;
        // ✅ ADD THESE CASES
        case 'ai-output-image':
          details = `is an AI image generated from the prompt: "${node.source_prompt}"`;
          break;
        case 'ai-output-3d':
          details = `is a 3D model generated from the prompt: "${node.source_prompt}"`;
          break;
        default:
          details = `is a ${node.type} node`;
      }
        return `• Node #${Math.floor(node.id)} (${node.type}) ${details}`;
      }).join('\n');
      const mockResponse = `Here's an analysis of the selected nodes:\n${nodeDescriptions}\n\nYou asked: "${payload.prompt}"`;
      return { message: mockResponse };
    }
    return { message: `I'm a canvas assistant. Select one or more nodes and ask me a question about them.` };
  };

  const sendChat = async () => {
    const trimmedInput = chatInput.trim();
    if (trimmedInput === '') return;
    const userMessage = { sender: 'user', text: trimmedInput };
    const tempMessageId = Date.now();
    setChatMessages((prev) => [...prev, userMessage, { sender: 'bot', text: 'Thinking...', id: tempMessageId }]);
    setChatInput('');
    const context_nodes = selectedIds.map(id => getNodePayload(assetHistory[id])).filter(Boolean);
    const payload = { prompt: trimmedInput, context_nodes };
    const result = await mockApiCall(payload);
    if (result.message) {
      setChatMessages(prev => prev.map(msg => msg.id === tempMessageId ? { sender: 'bot', text: result.message } : msg));
    }
  };

  // --- Helper Functions ---
  const getNextNodeId = () => Date.now() + Math.random();
  const getNodeLabel = (type) => {
    switch (type) {
      case 'text': return 'Text Node';
      case 'image': return 'Image Node';
      case 'color': return 'Color Node';
      case 'size': return 'Size Node';
      case 'mix': return 'Mix Node';
      case 'ai-output-image': return 'AI Generated Image';
      case 'ai-output-3d': return 'AI Generated 3D Model';
      case 'shape': return 'Shape';
      default: return 'Unknown Node';
    }
  };
  const getCurvePath = (fromX, fromY, toX, toY) => {
    const curveX = Math.abs(toX - fromX) * 0.5;
    return `M ${fromX} ${fromY} C ${fromX + curveX} ${fromY}, ${toX - curveX} ${toY}, ${toX} ${toY}`;
  };
  const toggleSelection = (id) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((selId) => selId !== id) : [...prev, id]);
  };

  // --- Node Management ---
  const addNode = (type) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const centerX = (canvas.clientWidth / 2 - offset.x) / scale;
    const centerY = (canvas.clientHeight / 2 - offset.y) / scale;
    const id = getNextNodeId();
    const newNode = { id, type, x: centerX, y: centerY, content: '', file: null };
    if (type === 'color') { newNode.color = '#000DFF'; newNode.opacity = 100; }
    if (type === 'size') { newNode.size = { x: '', y: '', z: '' }; }
    setAssetHistory(prev => ({ ...prev, [id]: newNode }));
    setCanvasAssetIds(prev => [...prev, id]);
  };

  const createMixNode = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const centerX = (canvas.clientWidth / 2 - offset.x) / scale;
    const centerY = (canvas.clientHeight / 2 - offset.y) / scale;
    const id = getNextNodeId();
    const newNode = { id, type: 'mix', x: centerX, y: centerY, inputs: [] };
    setAssetHistory(prev => ({ ...prev, [id]: newNode }));
    setCanvasAssetIds(prev => [...prev, id]);
  };
  
  const generateAINode = (type) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const centerX = (canvas.clientWidth / 2 - offset.x) / scale;
    const centerY = (canvas.clientHeight / 2 - offset.y) / scale;
    const id = getNextNodeId();
    const newNode = { id, type, x: centerX, y: centerY, content: `Mock ${type} result` };
    setAssetHistory(prev => ({ ...prev, [id]: newNode }));
    setCanvasAssetIds(prev => [...prev, id]);
  };
  
  const handleCompile = () => {
    setChatMessages((prev) => [...prev, { sender: 'bot', text: '⚙️ Compiling workflow...' }]);
  };

  // --- Canvas Interaction & Dragging (CORRECTED) ---
  const handleMouseDown = (e) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - offset.x) / scale;
    const y = (e.clientY - rect.top - offset.y) / scale;

    if (activeTool === 'rectangle') {
        setDrawingRect({ x, y, width: 0, height: 0 });
        return; 
    } else if (activeTool === 'text') {
        const newId = getNextNodeId();
        setTextBlocks((prev) => [...prev, { id: newId, x, y, text: 'New Text' }]);
        setActiveTool('mouse');
        return;
    }

    if (e.target !== canvasRef.current) return;
    setIsDragging(true);
    setStartDrag({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    setSelectedIds([]);
  };

  const handleMouseMove = (e) => {
    if (activeTool === 'rectangle' && drawingRect) {
      const rect = canvasRef.current.getBoundingClientRect();
      const currentX = (e.clientX - rect.left - offset.x) / scale;
      const currentY = (e.clientY - rect.top - offset.y) / scale;
      setDrawingRect(prev => ({ ...prev, width: currentX - prev.x, height: currentY - prev.y }));
      return;
    }
    if (draggingTextId !== null) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - offset.x) / scale;
      const mouseY = (e.clientY - rect.top - offset.y) / scale;
      setTextBlocks((prev) => prev.map((tb) => tb.id === draggingTextId ? { ...tb, x: mouseX - textDragOffset.x, y: mouseY - textDragOffset.y } : tb));
      return;
    }
    if (drawingConnection) {
        setDrawingConnection(prev => ({ ...prev, toX: e.clientX, toY: e.clientY }));
        return;
    }
    if (!isDragging) return;
    setOffset({ x: e.clientX - startDrag.x, y: e.clientY - startDrag.y });
  };

  const handleMouseUp = (e) => {
    // This function now ONLY handles events that started on the main canvas background.
    
    if (activeTool === 'rectangle' && drawingRect) {
      const finalRect = {
        id: getNextNodeId(),
        x: drawingRect.width < 0 ? drawingRect.x + drawingRect.width : drawingRect.x,
        y: drawingRect.height < 0 ? drawingRect.y + drawingRect.height : drawingRect.y,
        width: Math.abs(drawingRect.width),
        height: Math.abs(drawingRect.height),
      };
      if (finalRect.width > 5 && finalRect.height > 5) {
          setShapes(prev => [...prev, finalRect]);
      }
      setDrawingRect(null);
      setActiveTool('mouse');
    }
    
    // Reset general dragging states. The connection state is now handled locally.
    setIsDragging(false);
    setDraggingTextId(null);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomFactor = 0.1;
    const direction = e.deltaY < 0 ? 1 : -1;
    const newScale = Math.min(Math.max(scale + direction * zoomFactor, 0.2), 3);
    const worldX = (mouseX - offset.x) / scale;
    const worldY = (mouseY - offset.y) / scale;
    const newOffsetX = mouseX - worldX * newScale;
    const newOffsetY = mouseY - worldY * newScale;
    setScale(newScale);
    setOffset({ x: newOffsetX, y: newOffsetY });
  };

  const handleNodeDrag = (e, id) => {
    const deltaX = e.movementX / scale;
    const deltaY = e.movementY / scale;
    setAssetHistory(prev => {
        const newHistory = { ...prev };
        const idsToMove = selectedIds.includes(id) ? selectedIds : [id];
        idsToMove.forEach(moveId => {
            if (newHistory[moveId]) {
                newHistory[moveId] = { ...newHistory[moveId], x: newHistory[moveId].x + deltaX, y: newHistory[moveId].y + deltaY };
            }
        });
        return newHistory;
    });
  };

  const exportAsSVG = () => {
    const allAssets = canvasAssetIds.map(id => assetHistory [id]);
    if (allAssets.length === 0 && textBlocks.length === 0 && shapes.length === 0) return;

    const nodeWidth = 180;
    const nodeHeight = 100; // Increased height to accommodate content
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    allAssets.forEach(node => {
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + (node.width || nodeWidth));
        maxY = Math.max(maxY, node.y + (node.height || nodeHeight));
    });
    shapes.forEach(shape => {
        minX = Math.min(minX, shape.x); minY = Math.min(minY, shape.y);
        maxX = Math.max(maxX, shape.x + shape.width); maxY = Math.max(maxY, shape.y + shape.height);
    });
    textBlocks.forEach(tb => {
        minX = Math.min(minX, tb.x); minY = Math.min(minY, tb.y);
        maxX = Math.max(maxX, tb.x + 150); maxY = Math.max(maxY, tb.y + 24);
    });

    const padding = 40;
    minX -= padding; minY -= padding;
    maxX += padding; maxY += padding;
    const width = maxX - minX;
    const height = maxY - minY;

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">`;
    svgContent += `<defs><marker id="arrow" markerWidth="10" markerHeight="7" refX="5" refY="3.5" orient="auto" markerUnits="strokeWidth"><polygon points="0 0, 10 3.5, 0 7" fill="#0ea5e9" /></marker></defs>`;

    connections.forEach(conn => {
        const from = assetHistory [conn.from];
        const to = assetHistory [conn.to];
        if (!from || !to) return;
        const fromX = from.x + 180;
        const fromY = from.y + 50; // Adjusted Y for better connection point
        const toX = to.x;
        const toY = to.y + 50;   // Adjusted Y for better connection point
        svgContent += `<path d="${getCurvePath(fromX, fromY, toX, toY)}" stroke="#0ea5e9" stroke-width="2" fill="none" marker-end="url(#arrow)" />`;
    });

    shapes.forEach(shape => {
        svgContent += `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="rgba(0,0,0,0.05)" stroke="#000" stroke-width="1.5"/>`;
    });
    textBlocks.forEach(tb => {
        svgContent += `<text x="${tb.x}" y="${tb.y + 14}" font-size="14" fill="black" font-family="sans-serif">${tb.text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text>`;
    });

    allAssets.forEach(node => {
        const x = node.x;
        const y = node.y;
        svgContent += `<rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" fill="#111827" stroke="#ccc" rx="10" ry="10"/>`;
        svgContent += `<text x="${x + 10}" y="${y + 20}" fill="white" font-family="sans-serif" font-size="13" font-weight="bold">${getNodeLabel(node.type)} - ID ${Math.floor(node.id)}</text>`;

        // Add content based on node type
        const contentYStart = y + 40;
        switch (node.type) {
            case 'text':
                const wrappedText = node.content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                svgContent += `<text x="${x + 10}" y="${contentYStart}" fill="white" font-family="sans-serif" font-size="12">${wrappedText}</text>`;
                break;
            case 'image':
                if (node.file) {
                    svgContent += `<image x="${x + 10}" y="${contentYStart}" width="160" height="40" href="${node.file.replace(/</g, "&lt;").replace(/>/g, "&gt;")}" preserveAspectRatio="contain" />`;
                } else {
                    svgContent += `<text x="${x + 10}" y="${contentYStart}" fill="white" font-family="sans-serif" font-size="12">No file chosen</text>`;
                }
                break;
            case 'color':
                svgContent += `<rect x="${x + 10}" y="${contentYStart}" width="30" height="30" fill="${node.color}" stroke="#eee" />`;
                svgContent += `<text x="${x + 50}" y="${contentYStart + 15}" fill="white" font-family="sans-serif" font-size="12">${node.color.toUpperCase()}</text>`;
                svgContent += `<text x="${x + 50}" y="${contentYStart + 30}" fill="white" font-family="sans-serif" font-size="12">Opacity: ${node.opacity}%</text>`;
                break;
            case 'size':
                svgContent += `<text x="${x + 10}" y="${contentYStart}" fill="white" font-family="sans-serif" font-size="12">X: ${node.size.x || ''}</text>`;
                svgContent += `<text x="${x + 10}" y="${contentYStart + 15}" fill="white" font-family="sans-serif" font-size="12">Y: ${node.size.y || ''}</text>`;
                svgContent += `<text x="${x + 10}" y="${contentYStart + 30}" fill="white" font-family="sans-serif" font-size="12">Z: ${node.size.z || ''}</text>`;
                break;
            case 'mix':
                const inputsText = (node.inputs || []).map(input => `- Input ID: ${Math.floor(input.nodeId)}, Weight: ${input.weight}%`).join('\n');
                inputsText.split('\n').forEach((line, index) => {
                    svgContent += `<text x="${x + 10}" y="${contentYStart + (index * 12)}" fill="white" font-family="sans-serif" font-size="10">${line}</text>`;
                });
                break;
            case 'ai-output-image':
                svgContent += `<text x="${x + 10}" y="${contentYStart + 15}" fill="white" font-family="sans-serif" font-size="12">${node.content}</text>`;
                break;
            case 'ai-output-3d':
                svgContent += `<text x="${x + 10}" y="${contentYStart + 15}" fill="white" font-family="sans-serif" font-size="12">${node.content}</text>`;
                break;
            default:
                break;
        }
    });

    svgContent += `</svg>`;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.download = 'pnb-export.svg';
    link.href = URL.createObjectURL(blob);
    link.click();
  };


  // --- Effects ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const suppressContextMenu = (e) => e.preventDefault();
    canvas.addEventListener('contextmenu', suppressContextMenu);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('contextmenu', suppressContextMenu);
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [scale, offset]);

  useEffect(() => { if (chatInputRef.current) { chatInputRef.current.style.height = 'auto'; chatInputRef.current.style.height = `${chatInputRef.current.scrollHeight}px`; } }, [chatInput]);
  useEffect(() => { const msgContainer = document.querySelector('.chat-messages'); if (msgContainer) { msgContainer.scrollTop = msgContainer.scrollHeight; } }, [chatMessages]);

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <h1>Programming node-based Interface</h1>
        </div>
        <div className="header-right">
          <button className="save-button" onClick={exportAsSVG}>Export SVG</button>
        </div>
      </header>
      <div className="app-body">
        <aside className="app-sidebar">
          <div className="sidebar-section">
            <div className="section-title">CREATE NODES</div>
            <div className="section-subtext">Select nodes to create</div>
            <button className="sidebar-button mt-1" onClick={() => addNode('text')}>Text Input</button>
            <button className="sidebar-button" onClick={() => addNode('image')}>Image Input</button>
          </div>
          <hr className="sidebar-divider" />
          <div className="sidebar-section">
            <div className="section-title">PARAMETER NODES</div>
            <div className="section-subtext">Select nodes for edit</div>
            <button className="sidebar-button mt-1" onClick={() => addNode('color')}>Color Node</button>
            {/* --- Size node 사용 안할 예정입니다 --- */}
            {/* <button className="sidebar-button" onClick={() => addNode('size')}>Size Node</button> */}
            <button className="sidebar-button" onClick={createMixNode}>Mix Node</button>
          </div>
          <hr className="sidebar-divider" />
          <div className="sidebar-section">
            <div className="section-title">GENERATE NODE</div>
            <div className="section-subtext">Select to generate type</div>
            <button className="sidebar-button mt-1" onClick={() => generateAINode('ai-output-image')}>Generate Image</button>
            <button className="sidebar-button" onClick={() => generateAINode('ai-output-3d')}>Generate 3D</button>
          </div>
          <hr className="sidebar-divider" />
          <div className="sidebar-section">
            <div className="section-title">COMPILE</div>
            <div className="section-subtext">Click compile to generate result</div>
            <button className="sidebar-button mt-1" onClick={handleCompile}>COMPILE</button>
          </div>
        </aside>

        <main
          className="app-main"
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{
            backgroundPosition: `${offset.x % 40}px ${offset.y % 40}px`,
            backgroundSize: `${40 * scale}px ${40 * scale}px`,
          }}
        >
          <div
            className="canvas-content-wrapper"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              pointerEvents: 'none',
            }}>
              <div className="canvas-content" style={{ pointerEvents: 'auto' }}>
                <svg
                  className="canvas-connections"
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
                >
                  <defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="5" refY="3.5" orient="auto" markerUnits="strokeWidth">
                      <polygon points="0 0, 10 3.5, 0 7" fill="#0ea5e9" />
                    </marker>
                  </defs>
                  {connections.map((conn, index) => {
                    const fromNode = assetHistory[conn.from];
                    const toNode = assetHistory[conn.to];
                    if (!fromNode || !toNode) return null;
                    const fromX = fromNode.x + 180;
                    const fromY = fromNode.y + 40;
                    const toX = toNode.x;
                    const toY = toNode.y + 40;
                    const pathData = getCurvePath(fromX, fromY, toX, toY);
                    return ( <path key={`${conn.from}-${conn.to}-${index}`} d={pathData} fill="none" stroke="#0ea5e9" strokeWidth="2" markerEnd="url(#arrowhead)" /> );
                  })}
                  {drawingConnection && (() => {
                    const fromX = (drawingConnection.fromX - offset.x) / scale;
                    const fromY = (drawingConnection.fromY - offset.y) / scale;
                    const toX = (drawingConnection.toX - offset.x) / scale;
                    const toY = (drawingConnection.toY - offset.y) / scale;
                    const pathData = getCurvePath(fromX, fromY, toX, toY);
                    return (<path d={pathData} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4"/>);
                  })()}
                </svg>
                
                {/* --- CORRECTED JSX FOR SHAPES AND TEXT --- */}
                {shapes.map((shape) => (
                  <div
                    key={shape.id}
                    className="canvas-shape-final"
                    style={{ left: shape.x, top: shape.y, width: shape.width, height: shape.height }}
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        const move = (event) => {
                            const deltaX = event.movementX / scale;
                            const deltaY = event.movementY / scale;
                            setShapes((prev) => prev.map((s) => s.id === shape.id ? { ...s, x: s.x + deltaX, y: s.y + deltaY } : s));
                        };
                        const up = () => window.removeEventListener('mousemove', move);
                        window.addEventListener('mousemove', move);
                        window.addEventListener('mouseup', up, { once: true });
                    }}
                  >
                    <button className="close-button" onClick={(e) => { e.stopPropagation(); setShapes(prev => prev.filter(s => s.id !== shape.id)); }} style={{ top: '-10px', right: '-10px', color: '#333' }}>×</button>
                    <div className="resize-handle"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const startX = e.clientX; const startY = e.clientY;
                        const startWidth = shape.width; const startHeight = shape.height;
                        const resize = (event) => {
                            const dx = (event.clientX - startX) / scale;
                            const dy = (event.clientY - startY) / scale;
                            setShapes(prev => prev.map(s => s.id === shape.id ? { ...s, width: Math.max(20, startWidth + dx), height: Math.max(20, startHeight + dy)} : s));
                        };
                        const stopResize = () => window.removeEventListener('mousemove', resize);
                        window.addEventListener('mousemove', resize);
                        window.addEventListener('mouseup', stopResize, { once: true });
                      }}
                    />
                  </div>
                ))}
                
                {textBlocks.map((tb) => (
                  <div key={tb.id} className="text-block-container" style={{ position: 'absolute', left: tb.x, top: tb.y, pointerEvents: 'auto' }}>
                    <button className="close-button" onClick={(e) => { e.stopPropagation(); setTextBlocks((prev) => prev.filter((b) => b.id !== tb.id)); }} style={{ top: '-10px', right: '-10px', color: '#333' }}>×</button>
                    <textarea className="canvas-text-block" value={tb.text} onChange={(e) => setTextBlocks((prev) => prev.map((b) => (b.id === tb.id ? { ...b, text: e.target.value } : b)))}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const rect = canvasRef.current.getBoundingClientRect();
                        const offsetX = (e.clientX - rect.left - offset.x) / scale - tb.x;
                        const offsetY = (e.clientY - rect.top - offset.y) / scale - tb.y;
                        setDraggingTextId(tb.id);
                        setTextDragOffset({ x: offsetX, y: offsetY });
                        
                        // Use a local up handler to avoid conflicts
                        const up = () => {
                            setDraggingTextId(null);
                            window.removeEventListener('mouseup', up);
                        };
                        window.addEventListener('mouseup', up, { once: true });
                      }}
                    />
                  </div>
                ))}

                {drawingRect && (<div className="canvas-shape-preview" style={{ left: drawingRect.x, top: drawingRect.y, width: drawingRect.width, height: drawingRect.height }}/>)}
                
                {canvasAssetIds.map(id => {
                  const node = assetHistory[id];
                  if (!node) return null;
                  
                  return (
                    <div key={id} className={`canvas-node ${selectedIds.includes(id) ? 'selected' : ''}`} style={{ left: node.x, top: node.y, pointerEvents: 'auto' }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        toggleSelection(id);
                        const move = (event) => handleNodeDrag(event, id);
                        const up = () => window.removeEventListener('mousemove', move);
                        window.addEventListener('mousemove', move);
                        window.addEventListener('mouseup', up, { once: true });
                      }}
                    >
                      <button className="close-button" onClick={(e) => {
                          e.stopPropagation();
                          setCanvasAssetIds(prev => prev.filter(assetId => assetId !== id));
                          setSelectedIds(prev => prev.filter(selId => selId !== id));
                          setConnections(prev => prev.filter(c => c.from !== id && c.to !== id));
                      }}>×</button>
                      
                      {['mix', 'ai-output-image', 'ai-output-3d'].includes(node.type) && (
                        <div className="socket input-socket" data-nodeid={node.id} ref={(el) => { if (el) socketRefs.current[`in-${node.id}`] = el; }} />
                      )}
                      {['text', 'image', 'color', 'size', 'mix'].includes(node.type) && (
                        <div className="socket output-socket" data-nodeid={node.id} ref={(el) => { if (el) socketRefs.current[`out-${node.id}`] = el; }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            
                            // Use the exact starting position from the original event
                            const fromX = e.clientX;
                            const fromY = e.clientY;
                            
                            setDrawingConnection({
                              fromNodeId: node.id,
                              fromX: fromX,
                              fromY: fromY,
                              toX: fromX, // Start the line at the same point
                              toY: fromY,
                            });

                            // This function ONLY handles moving the wire's end point
                            const move = (event) => {
                              setDrawingConnection((prev) => ({ ...prev, toX: event.clientX, toY: event.clientY }));
                            };

                            // This function ONLY handles what happens when the connection drag ends
                            const up = (event) => {
                              // Find the element under the cursor
                              const target = document.elementFromPoint(event.clientX, event.clientY);
                              const socket = target?.closest('.input-socket');
                              const toNodeId = socket?.dataset?.nodeid;
                              
                              // Finalize the connection if dropped on a valid input socket
                              if (toNodeId && toNodeId !== `${node.id}`) {
                                const toId = parseFloat(toNodeId);
                                const fromId = node.id;
                                // Check if connection already exists
                                const alreadyConnected = connections.some((c) => c.from === fromId && c.to === toId);
                                if (!alreadyConnected) {
                                  setConnections((prev) => [...prev, { from: fromId, to: toId }]);
                                  // If connecting to a mix node, add the new input
                                  setAssetHistory(prev => {
                                      const toNode = prev[toId];
                                      if (toNode && toNode.type === 'mix') {
                                          const fromNode = prev[fromId];
                                          const newInput = { nodeId: fromId, label: getNodeLabel(fromNode?.type), weight: 50 };
                                          const updatedInputs = [...(toNode.inputs || []), newInput];
                                          return { ...prev, [toId]: { ...toNode, inputs: updatedInputs } };
                                      }
                                      return prev;
                                  });
                                }
                              }

                              // Reset the drawing state and clean up listeners
                              setDrawingConnection(null);
                              window.removeEventListener('mousemove', move);
                              window.removeEventListener('mouseup', up);
                            };

                            // Add the specific listeners for this action
                            window.addEventListener('mousemove', move);
                            window.addEventListener('mouseup', up);
                          }}
                        />
                      )}
                      
                      <strong>{getNodeLabel(node.type)} - ID {Math.floor(node.id)}</strong>
                      
                      {node.type === 'text' && ( <textarea className="node-textarea" value={node.content} onChange={(e) => setAssetHistory(p => ({ ...p, [id]: { ...p[id], content: e.target.value } }))} /> )}
                      {node.type === 'image' && (
                        <>
                          <input type="file" accept="image/*" style={{ marginTop: '0.5rem' }} onChange={(e) => {
                            if (e.target.files[0]) {
                              const reader = new FileReader();
                              reader.onload = (event) => setAssetHistory(p => ({ ...p, [id]: { ...p[id], file: event.target.result } }));
                              reader.readAsDataURL(e.target.files[0]);
                            }
                          }}/>
                          {node.file && <img src={node.file} alt="Preview" className="node-image-preview"/>}
                        </>
                      )}
                      {node.type === 'color' && (
                        <div className="color-node">
                           <div className="color-controls">
                            <input type="color" value={node.color} onChange={(e) => setAssetHistory(p => ({...p, [id]: {...p[id], color: e.target.value}}))}/>
                            <input type="text" value={node.color.toUpperCase()} readOnly className="hex-display" />
                            <input type="number" value={node.opacity} min="0" max="100" className="opacity-input" onChange={(e) => setAssetHistory(p => ({...p, [id]: {...p[id], opacity: parseInt(e.target.value) || 0}}))} />
                            <span>%</span>
                           </div>
                        </div>
                      )}
                      {node.type === 'size' && (
                        <div className="size-node">
                            <div className="size-controls">
                                {['x', 'y', 'z'].map((axis) => (
                                    <div key={axis} className="axis-input">
                                        <label>{axis.toUpperCase()}:</label>
                                        <input type="number" value={node.size[axis]} className="axis-field" onChange={(e) => setAssetHistory(p => ({...p, [id]: {...p[id], size: {...p[id].size, [axis]: e.target.value}} }))} />
                                    </div>
                                ))}
                            </div>
                        </div>
                      )}
                      {node.type === 'mix' && (
                        <div className="mix-node-inputs">
                            {(node.inputs || []).map((input, idx) => (
                                <div key={idx} className="mix-input-row">
                                    <span className="mix-label">{getNodeLabel(assetHistory[input.nodeId]?.type)} - ID {Math.floor(input.nodeId)}</span>
                                    <input type="number" min="0" max="100" value={input.weight} className="mix-percentage-input" onChange={(e) => {
                                        const newWeight = parseInt(e.target.value) || 0;
                                        setAssetHistory(prev => {
                                            const updatedNode = { ...prev[id] };
                                            const updatedInputs = [...updatedNode.inputs];
                                            updatedInputs[idx] = { ...updatedInputs[idx], weight: newWeight };
                                            return { ...prev, [id]: { ...updatedNode, inputs: updatedInputs } };
                                        });
                                    }}/>
                                </div>
                            ))}
                        </div>
                      )}
                      {node.type === 'ai-output-image' && ( <div className="ai-placeholder"><span>🖼️</span><small>{node.content}</small></div> )}
                      {node.type === 'ai-output-3d' && ( <div className="ai-placeholder"><span>📦</span><small>{node.content}</small></div> )}
                    </div>
                  );
                })}

              </div>
          </div>
        </main>
        
        <div className="chat-panel">
          <div className="chat-messages">
            {chatMessages.map((msg, idx) => (
              <div key={msg.id || idx} className={`chat-message ${msg.sender === 'user' ? 'user' : 'bot'}`}>
                {msg.text.split('\n').map((line, i) => <p key={i} style={{margin:0}}>{line}</p>)}
              </div>
            ))}
          </div>
          <div className="chat-input-box">
            <textarea
              ref={chatInputRef}
              value={chatInput}
              placeholder="Select nodes and ask a question..."
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              rows={1}
              className="chat-textarea"
            />
            <button onClick={sendChat}>Send</button>
          </div>
        </div>

        <div className="canvas-toolbar">
          <button className={`toolbar-button ${activeTool === 'mouse' ? 'active' : ''}`} onClick={() => setActiveTool('mouse')}>
            <img src="/icons/mouse.png" alt="Mouse Tool" />
          </button>
          <button className={`toolbar-button ${activeTool === 'rectangle' ? 'active' : ''}`} onClick={() => setActiveTool('rectangle')}>
            <img src="/icons/rectangle.png" alt="Rectangle Tool" />
          </button>
          <button className={`toolbar-button ${activeTool === 'text' ? 'active' : ''}`} onClick={() => setActiveTool('text')}>
            <img src="/icons/text.png" alt="Text Tool" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
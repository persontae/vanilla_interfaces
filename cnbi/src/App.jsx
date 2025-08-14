import { useRef, useState, useEffect } from 'react';
import './App.css';

function App() {
  // --- State and Refs ---
  const canvasRef = useRef(null);
  const chatInputRef = useRef(null);
  const zoomAnimationFrame = useRef(null);
  const latestWheelEvent = useRef(null);

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

  // These elements are not part of the agentic "asset" system yet
  const [shapes, setShapes] = useState([]); // ✅ ADD THIS LINE BACK
  const [drawingRect, setDrawingRect] = useState(null);
  const [textBlocks, setTextBlocks] = useState([]);
  const [draggingTextId, setDraggingTextId] = useState(null);
  const [textDragOffset, setTextDragOffset] = useState({ x: 0, y: 0 });
  
  // --- Chat State ---
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // --- NEW: MOCK API & CONTEXT HANDLING ---
  
  /**
   * Creates a simple, readable description of a node for the AI's context.
   * For a real API, you might send the full node object or a more detailed summary.
   */
  const getNodePayload = (node) => {
    if (!node) return null;
    
    // This object defines the data structure sent to the API for any given node.
    const payload = {
      id: node.id,
      type: node.type,
      content: node.content, // Send content for all types
    };

    // Add type-specific details
    if (node.type === 'image' && node.file) {
        // For images, we can send the filename or truncated data
        payload.fileName = node.file.split('/').pop().split('?')[0].substring(0, 20); 
    }
    if (node.type === 'ai-output-image' || node.type === 'ai-output-3d') {
        payload.source_prompt = node.source_prompt;
    }
    if (node.type === 'mix') {
        payload.input_count = node.inputs.length;
        payload.input_ids = node.inputs.map(i => i.nodeId);
    }
    
    return payload;
  };

  /**
   * Simulates a backend API call. It only handles inquiries about existing nodes.
   */
  const mockApiCall = async (payload) => {
    console.log("Sending Inquiry to Mock API:", payload);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay

    if (payload.context_nodes.length > 0) {
      // For each node in the context, create a detailed description string
      const nodeDescriptions = payload.context_nodes.map(node => {
        let details = '';
        switch (node.type) {
          case 'text':
            details = `contains text: "${(node.content || '').substring(0, 50)}..."`;
            break;
          case 'image':
            details = `is an image named "${node.fileName || 'unnamed'}"`;
            break;
          case 'ai-output-image':
            details = `is an AI image generated from the prompt: "${node.source_prompt}"`;
            break;
          case 'ai-output-3d':
            details = `is a 3D model generated from the prompt: "${node.source_prompt}"`;
            break;
          case 'mix':
            details = `mixes ${node.input_count} nodes with IDs: ${node.input_ids.join(', ')}`;
            break;
          default:
            details = `is an asset of type ${node.type}`;
        }
        return `• Node #${node.id} (${node.type}) ${details}`;
      }).join('\n'); // Join with newlines for readability

      const mockResponse = `Here's an analysis of the selected nodes:\n${nodeDescriptions}\n\nYou asked: "${payload.prompt}"`;
      return { message: mockResponse };
    }

    // Fallback for general chat without context
    return { message: `I'm a canvas assistant. Select one or more nodes and ask me a question about them.` };
  };

  // --- REFACTORED: Context-Aware Chat Handler ---
  const sendChat = async () => {
    const trimmedInput = chatInput.trim();
    if (trimmedInput === '') return;

    const userMessage = { sender: 'user', text: trimmedInput };
    const tempMessageId = Date.now();
    setChatMessages((prev) => [...prev, userMessage, { sender: 'bot', text: 'Thinking...', id: tempMessageId }]);
    setChatInput('');

    // 1. Gather Context: Find selected nodes and create their API payloads.
    const context_nodes = selectedIds.map(id => {
      const node = assetHistory[id];
      return getNodePayload(node);
    }).filter(Boolean); // Filter out any nulls if a node wasn't found

    // 2. Construct the API Payload
    const payload = {
      prompt: trimmedInput,
      context_nodes: context_nodes,
    };

    // 3. Call the API
    const result = await mockApiCall(payload);

    // 4. Display the API's text response
    if (result.message) {
      setChatMessages(prev => prev.map(msg => 
        msg.id === tempMessageId ? { sender: 'bot', text: result.message } : msg
      ));
    }
  };

  // --- Helper Functions ---
  const getNextNodeId = () => Date.now();
  
  const getNodeLabel = (type) => {
    switch (type) {
      case 'text': return 'Text Node';
      case 'image': return 'Image Node';
      case 'ai-output-image': return 'AI Generated Image';
      case 'ai-output-3d': return 'AI Generated 3D Model';
      case 'mix': return 'Mix Node';
      default: return 'Unknown Node';
    }
  };

  const getCurvePath = (fromX, fromY, toX, toY) => {
    const curveX = Math.abs(toX - fromX) * 0.5;
    return `M ${fromX} ${fromY} C ${fromX + curveX} ${fromY}, ${toX - curveX} ${toY}, ${toX} ${toY}`;
  };

  const toggleSelection = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((selId) => selId !== id) : [...prev, id]
    );
  };

  // --- Node Management (Manual Creation via Buttons) ---
  
  const addNode = (type) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const centerX = (canvas.clientWidth / 2 - offset.x) / scale;
    const centerY = (canvas.clientHeight / 2 - offset.y) / scale;
    const id = getNextNodeId();
    const newNode = { id, type, x: centerX, y: centerY, content: '', file: null };

    setAssetHistory(prev => ({...prev, [id]: newNode}));
    setCanvasAssetIds(prev => [...prev, id]);
  };

  const createMixNode = () => {
    const validSelections = selectedIds
      .map(id => assetHistory[id])
      .filter(n => n && (n.type === 'text' || n.type === 'image' || n.type === 'ai-output-image'));

    if (validSelections.length < 2) {
      alert("Select at least two valid input nodes (Text, Image, or AI Image) to create a Mix Node.");
      return;
    }
    const canvas = canvasRef.current;
    const centerX = (canvas.clientWidth / 2 - offset.x) / scale;
    const centerY = (canvas.clientHeight / 2 - offset.y) / scale;
    const id = getNextNodeId();
    const mixInputs = validSelections.map(n => ({ nodeId: n.id, label: getNodeLabel(n.type), weight: 0 }));
    const newNode = { id, type: 'mix', x: centerX, y: centerY, inputs: mixInputs };

    setAssetHistory(prev => ({...prev, [id]: newNode}));
    setCanvasAssetIds(prev => [...prev, id]);
    setConnections(prev => [
      ...prev,
      ...validSelections.map(n => ({ from: n.id, to: id }))
    ]);
  };

  const generateAINode = (type) => {
    if (selectedIds.length === 0) {
      alert("Please select at least one node before generating.");
      return;
    }
    // The placeholder message logic remains the same
    const messageText = type === 'ai-output-image' ? '🖼️ Generating image result...' : '📦 Generating 3D result...';
    setChatMessages((prev) => [...prev, { sender: 'bot', text: messageText }]);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const centerX = (canvas.clientWidth / 2 - offset.x) / scale;
    const centerY = (canvas.clientHeight / 2 - offset.y) / scale;
    const id = getNextNodeId();
    const newNode = { id, type, x: centerX, y: centerY, content: `Mock ${type} result`, file: null, source_prompt: 'Generated via button' };

    setAssetHistory(prev => ({...prev, [id]: newNode}));
    setCanvasAssetIds(prev => [...prev, id]);
    
    const validSourceNodes = selectedIds.filter(id => {
      const node = assetHistory[id];
      return node && node.type !== 'ai-output-3d';
    });

    setConnections((prev) => [
      ...prev,
      ...validSourceNodes.map((selId) => ({ from: selId, to: newNode.id })),
    ]);
  };

  // --- Canvas Interaction Handlers (CORRECTED) ---
  const handleMouseDown = (e) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - offset.x) / scale;
    const y = (e.clientY - rect.top - offset.y) / scale;

    if (activeTool === 'rectangle') {
      setDrawingRect({ x, y, width: 0, height: 0 });
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp, { once: true });
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
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });
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
      setTextBlocks((prev) => prev.map((tb) =>
          tb.id === draggingTextId
            ? { ...tb, x: mouseX - textDragOffset.x, y: mouseY - textDragOffset.y }
            : tb
        )
      );
      return;
    }

    if (!isDragging) return;
    setOffset({ x: e.clientX - startDrag.x, y: e.clientY - startDrag.y });
  };

  const handleMouseUp = () => {
    if (activeTool === 'rectangle' && drawingRect) {
      const finalRect = {
        id: getNextNodeId(),
        x: drawingRect.width < 0 ? drawingRect.x + drawingRect.width : drawingRect.x,
        y: drawingRect.height < 0 ? drawingRect.y + drawingRect.height : drawingRect.y,
        width: Math.abs(drawingRect.width),
        height: Math.abs(drawingRect.height),
      };
      if (finalRect.width > 5 && finalRect.height > 5) {
        setShapes((prev) => [...prev, finalRect]);
      }
      setDrawingRect(null);
      setActiveTool('mouse');
    }

    setIsDragging(false);
    setDraggingTextId(null);
    window.removeEventListener('mousemove', handleMouseMove);
  };
  
  // (handleWheel is unchanged)
  const handleWheel = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomFactor = 0.1;
    const direction = e.deltaY < 0 ? 1 : -1;
    const newScale = scale + direction * zoomFactor * scale;
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
    // MODIFIED: Gather all elements from the new state structure
    const allAssets = canvasAssetIds.map(id => assetHistory[id]);
    if (allAssets.length === 0 && textBlocks.length === 0 && shapes.length === 0) return;

    const nodeWidth = 180;
    const nodeHeight = 80;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    // --- Calculate Bounds ---
    allAssets.forEach(node => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + nodeWidth);
      maxY = Math.max(maxY, node.y + nodeHeight);
    });
    shapes.forEach(shape => {
      minX = Math.min(minX, shape.x);
      minY = Math.min(minY, shape.y);
      maxX = Math.max(maxX, shape.x + shape.width);
      maxY = Math.max(maxY, shape.y + shape.height);
    });
    textBlocks.forEach(tb => {
      minX = Math.min(minX, tb.x);
      minY = Math.min(minY, tb.y);
      maxX = Math.max(maxX, tb.x + 150); // Approx width
      maxY = Math.max(maxY, tb.y + 24);  // Approx height
    });

    const padding = 40;
    minX -= padding; minY -= padding;
    maxX += padding; maxY += padding;
    const width = maxX - minX;
    const height = maxY - minY;

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">`;
    svgContent += `
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="7" refX="5" refY="3.5" orient="auto" markerUnits="strokeWidth">
          <polygon points="0 0, 10 3.5, 0 7" fill="#0ea5e9" />
        </marker>
      </defs>
    `;

    // --- Render Elements ---
    
    // Connections
    connections.forEach(conn => {
      const from = assetHistory[conn.from]; // MODIFIED: Read from assetHistory
      const to = assetHistory[conn.to];     // MODIFIED: Read from assetHistory
      if (!from || !to) return;
      const fromX = from.x + 180;
      const fromY = from.y + 40;
      const toX = to.x;
      const toY = to.y + 40;
      const pathData = getCurvePath(fromX, fromY, toX, toY);
      svgContent += `<path d="${pathData}" stroke="#0ea5e9" stroke-width="2" fill="none" marker-end="url(#arrow)" />`;
    });

    // Shapes (Rectangles)
    shapes.forEach(shape => {
      svgContent += `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="none" stroke="#000" stroke-width="1.5"/>`;
    });

    // Text Blocks
    textBlocks.forEach(tb => {
      svgContent += `<text x="${tb.x}" y="${tb.y + 14}" font-size="14" fill="black" font-family="sans-serif">${tb.text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text>`;
    });

    // Nodes (Assets)
    allAssets.forEach(node => {
      const x = node.x;
      const y = node.y;
      svgContent += `<rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" fill="#111827" stroke="#ccc" rx="10" ry="10"/>`;
      svgContent += `<text x="${x + 10}" y="${y + 20}" fill="white" font-family="sans-serif" font-size="13" font-weight="bold">${getNodeLabel(node.type)}</text>`;
      
      let contentLines = [];
      if (node.type === 'text') {
        contentLines.push(`"${node.content || ''}"`);
      } else if (node.type === 'image') {
        contentLines.push(node.file ? `📷 (Uploaded Image)` : `📷 (No file)`);
      } else if (node.type === 'ai-output-image') {
        contentLines.push(`🖼 ${node.content || `Generated_Image_${node.id}.png`}`);
      } else if (node.type === 'ai-output-3d') {
        contentLines.push(`📦 ${node.content || `Generated_Model_${node.id}.glb`}`);
      } else if (node.type === 'mix') {
        contentLines.push(`Mix:`);
        node.inputs.forEach(input => {
          const inputNode = assetHistory[input.nodeId]; // MODIFIED: Read from assetHistory
          let name = 'Unknown Input';
          if (inputNode?.type === 'text') {
            name = `"${(inputNode.content || '').substring(0, 15)}..."`;
          } else if (inputNode?.type === 'image') {
            name = `📷 Image`;
          } else if (inputNode?.type === 'ai-output-image') {
            name = `🖼 ${inputNode.content || `Image_${inputNode.id}`}`;
          }
          contentLines.push(`${name} - ${input.weight}%`);
        });
      }

      contentLines.forEach((line, i) => {
        const textY = y + 38 + i * 16;
        svgContent += `<text x="${x + 10}" y="${textY}" fill="#ccc" font-family="sans-serif" font-size="12">${line.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text>`;
      });
    });

    svgContent += `</svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.download = 'canvas-export.svg';
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

  useEffect(() => {
    if (chatInputRef.current) {
      chatInputRef.current.style.height = 'auto';
      chatInputRef.current.style.height = chatInputRef.current.scrollHeight + 'px';
    }
  }, [chatInput]);
  
  useEffect(() => {
    const msgContainer = document.querySelector('.chat-messages');
    if (msgContainer) {
      msgContainer.scrollTop = msgContainer.scrollHeight;
    }
  }, [chatMessages]);

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <h1>Creative node-based Interface</h1>
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
            <button className="sidebar-button" onClick={createMixNode}>Mix Node</button>
          </div>
          <hr className="sidebar-divider" />
          <div className="sidebar-section">
            <div className="section-title">GENERATE ACTIONS</div>
            <div className="section-subtext">Select to generate type</div>
            <button className="sidebar-button mt-1" onClick={() => generateAINode('ai-output-image')}>Generate Image</button>
            <button className="sidebar-button" onClick={() => generateAINode('ai-output-3d')}>Generate 3D</button>
          </div>
          <hr className="sidebar-divider" />
          <div className="sidebar-section">
            <div className="section-title">SELECTION</div>
            <div className="section-subtext">{selectedIds.length} node{selectedIds.length !== 1 ? 's' : ''} selected</div>
            {selectedIds.map((id) => {
              const node = assetHistory[id];
              return <div key={id} className="section-item"> {getNodeLabel(node?.type)}</div>;
            })}
          </div>
        </aside>

        <main
          className="app-main"
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ backgroundPosition: `${offset.x % 40}px ${offset.y % 40}px`, backgroundSize: `${40 * scale}px ${40 * scale}px` }}
        >
          <div
            className="canvas-content-wrapper"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, pointerEvents: 'none' }}
          >
            <div className="canvas-content" style={{ pointerEvents: 'auto' }}>
              <svg className="canvas-connections" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
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
                    return <path key={index} d={pathData} fill="none" stroke="#0ea5e9" strokeWidth="2" markerEnd="url(#arrowhead)" />;
                  })}
              </svg>
              
              {/* --- REFACTORED RENDER LOOP --- */}
              {canvasAssetIds.map((id) => {
                const node = assetHistory[id];
                if (!node) return null;
                
                return (
                  <div
                    key={node.id}
                    className={`canvas-node ${selectedIds.includes(node.id) ? 'selected' : ''}`}
                    style={{ left: node.x, top: node.y, pointerEvents: 'auto' }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      toggleSelection(node.id);
                      const move = (event) => handleNodeDrag(event, node.id);
                      const up = () => {
                        window.removeEventListener('mousemove', move);
                        window.removeEventListener('mouseup', up);
                      };
                      window.addEventListener('mousemove', move);
                      window.addEventListener('mouseup', up);
                    }}
                  >
                    <button
                      className="close-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Refactor delete logic
                        setCanvasAssetIds(prev => prev.filter(assetId => assetId !== node.id));
                        setSelectedIds(prev => prev.filter(selId => selId !== node.id));
                        setConnections(prev => prev.filter(c => c.from !== node.id && c.to !== node.id));
                        // Note: asset remains in history unless you want to clean it up
                      }}
                    >×</button>
                    <strong>{getNodeLabel(node.type)}</strong>
                    
                    {/* --- Node Content Render Logic --- */}
                    {node.type === 'text' && (
                      <textarea
                        className="node-textarea"
                        value={node.content}
                        onChange={(e) => {
                          const newText = e.target.value;
                          setAssetHistory(prev => ({
                            ...prev,
                            [node.id]: { ...prev[node.id], content: newText }
                          }));
                        }}
                      />
                    )}
                    {node.type === 'image' && (
                        <>
                          <input
                            type="file" accept="image/*"
                            style={{ marginTop: '0.5rem' }}
                            onChange={(e) => {
                                const file = e.target.files[0];
                                if (file) {
                                    const reader = new FileReader();
                                    reader.onload = (event) => {
                                        setAssetHistory(prev => ({
                                            ...prev,
                                            [node.id]: {...prev[node.id], file: event.target.result }
                                        }));
                                    };
                                    reader.readAsDataURL(file);
                                }
                            }}
                          />
                          {node.file && <img src={node.file} alt="Preview" className="node-image-preview"/>}
                        </>
                    )}
                    {node.type === 'ai-output-image' && (
                        <div className="ai-placeholder">
                          {node.file ? <img src={node.file} alt={node.content} className="node-image-preview"/> : <span>🖼️</span>}
                          <small>{node.content}</small>
                        </div>
                    )}
                     {node.type === 'ai-output-3d' && (
                        <div className="ai-placeholder">
                            <span>📦</span>
                            <small>{node.content}</small>
                        </div>
                    )}
                    {node.type === 'mix' && (
                      <div className="mix-node-inputs">
                        {node.inputs.map((input, idx) => (
                          <div key={idx} className="mix-input-row">
                            <span className="mix-label">
                              {input.label} - ID {input.nodeId}
                            </span>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={input.weight}
                              className="mix-percentage-input"
                              onChange={(e) => {
                                const newWeight = parseInt(e.target.value) || 0;
                                // Update the state using the assetHistory pattern
                                setAssetHistory(prev => {
                                  const updatedNode = { ...prev[node.id] };
                                  const updatedInputs = [...updatedNode.inputs];
                                  updatedInputs[idx] = { ...updatedInputs[idx], weight: newWeight };
                                  updatedNode.inputs = updatedInputs;
                                  return { ...prev, [node.id]: updatedNode };
                                });
                              }}
                            />
                          </div>
                        ))}
                        <div className="mix-total-display">
                          Total: {node.inputs.reduce((sum, i) => sum + i.weight, 0)}%
                        </div>
                      </div>
                  )}
                  </div>
                );
              })}
              {/* ✅ CORRECTED JSX FOR SHAPES */}
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
                  <button
                    className="close-button"
                    onClick={(e) => { e.stopPropagation(); setShapes(prev => prev.filter(s => s.id !== shape.id)); }}
                    style={{ top: '-10px', right: '-10px', color: '#333' }}
                  >×</button>
                  <div
                    className="resize-handle"
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

              {/* ✅ CORRECTED JSX FOR TEXT BLOCKS */}
              {textBlocks.map((tb) => (
                <div
                  key={tb.id}
                  className="text-block-container"
                  style={{ position: 'absolute', left: tb.x, top: tb.y, pointerEvents: 'auto' }}
                >
                  {/* --- ADD THIS BUTTON --- */}
                  <button
                    className="close-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTextBlocks((prev) => prev.filter((b) => b.id !== tb.id));
                    }}
                    style={{ top: '-10px', right: '-10px', color: '#333' }}
                  >×</button>
                  {/* -------------------- */}
                  <textarea
                    className="canvas-text-block"
                    value={tb.text}
                    onChange={(e) => setTextBlocks((prev) => prev.map((b) => (b.id === tb.id ? { ...b, text: e.target.value } : b)))}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const rect = canvasRef.current.getBoundingClientRect();
                      const offsetX = (e.clientX - rect.left - offset.x) / scale - tb.x;
                      const offsetY = (e.clientY - rect.top - offset.y) / scale - tb.y;
                      setDraggingTextId(tb.id);
                      setTextDragOffset({ x: offsetX, y: offsetY });
                      window.addEventListener('mousemove', handleMouseMove);
                      window.addEventListener('mouseup', handleMouseUp, { once: true });
                    }}
                  />
                </div>
              ))}

              {drawingRect && (
                <div className="canvas-shape-preview" style={{ left: drawingRect.x, top: drawingRect.y, width: drawingRect.width, height: drawingRect.height }}/>
              )}

            </div>
          </div>
        </main>

        <div className="chat-panel">
          <div className="chat-messages">
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`chat-message ${msg.sender === 'user' ? 'user' : 'bot'}`}>
                {msg.text}
              </div>
            ))}
          </div>
          <div className="chat-input-box">
            <textarea
              ref={chatInputRef}
              value={chatInput}
              placeholder="Select nodes and ask a question..."
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              rows={1}
              className="chat-textarea"
            />
            <button onClick={sendChat}>Send</button>
          </div>
        </div>
        {/* ✅ ADD THIS ENTIRE DIV BACK */}
        <div className="canvas-toolbar">
          <button
            className={`toolbar-button ${activeTool === 'mouse' ? 'active' : ''}`}
            onClick={() => setActiveTool('mouse')}
          >
            <img src="/icons/mouse.png" alt="Mouse Tool" />
          </button>
          <button
            className={`toolbar-button ${activeTool === 'rectangle' ? 'active' : ''}`}
            onClick={() => setActiveTool('rectangle')}
          >
            <img src="/icons/rectangle.png" alt="Rectangle Tool" />
          </button>
          <button
            className={`toolbar-button ${activeTool === 'text' ? 'active' : ''}`}
            onClick={() => setActiveTool('text')}
          >
            <img src="/icons/text.png" alt="Text Tool" />
          </button>
        </div>

      </div>
    </div>
  );
}

export default App;
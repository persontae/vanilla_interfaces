import { useRef, useState, useEffect } from 'react';
import './App.css';

function App() {
  // --- State and Refs ---
  const canvasRef = useRef(null);
  const chatInputRef = useRef(null);
  const zoomAnimationFrame = useRef(null);
  const latestWheelEvent = useRef(null);

  // Canvas & Toolbar State
  const [activeTool, setActiveTool] = useState('mouse');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [startDrag, setStartDrag] = useState({ x: 0, y: 0 });

  // --- REFACTORED: Element State ---
  const [assetHistory, setAssetHistory] = useState({}); // "Local Database" storing all asset data
  const [imagePlaceholderIds, setImagePlaceholderIds] = useState([]); // Now just stores IDs
  const [model3DPlaceholderIds, setModel3DPlaceholderIds] = useState([]); // Now just stores IDs
  const [selectedImageIds, setSelectedImageIds] = useState([]); // Renamed for clarity
  const [selectedModel3DIds, setSelectedModel3DIds] = useState([]);
  
  const [shapes, setShapes] = useState([]); // Unchanged
  const [textBlocks, setTextBlocks] = useState([]); // Unchanged
  const [drawingRect, setDrawingRect] = useState(null);
  const [draggingTextId, setDraggingTextId] = useState(null);
  const [textDragOffset, setTextDragOffset] = useState({ x: 0, y: 0 });

  // Chat State
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // --- NEW: MOCK API & CONTEXT HANDLING ---

  /**
   * Simulates a backend API call. It inspects the payload to decide what to do.
   * In a real app, this `fetch` call would go to your developer's endpoint.
   * @param {object} payload - The contextual payload.
   */
  const mockApiCall = async (payload) => {
    console.log("Sending to Mock API:", payload);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay

    // REVISED: Check for commands anywhere in the prompt, not just at the start
    const imageCommandMatch = payload.prompt.match(/@(\d*)image/); 
    const model3DCommandMatch = payload.prompt.match(/@3d/);
    const hasContext = payload.context_assets.length > 0;

    // --- REORDERED AND REFINED LOGIC ---

    // 1. Check for GENERATION commands first. This always creates new assets.
    if (imageCommandMatch) {
      const numStr = imageCommandMatch[1];
      const numToGenerate = numStr ? parseInt(numStr, 10) : 1;
      const { startX, startY } = calculateNextRowLayout();
      const newAssets = [];
      for (let i = 0; i < numToGenerate; i++) {
        const newId = Date.now() + i;
        newAssets.push({
          asset_id: newId, asset_type: 'image', source_prompt: payload.prompt,
          parent_id: hasContext ? payload.context_assets[0].asset_id : null,
          file_url: `https://picsum.photos/id/${newId % 1000}/300/300`,
          x: startX + i * (300 + 20), y: startY, width: 300, height: 300,
        });
      }
      return { new_assets: newAssets };
    }
    
    if (model3DCommandMatch) {
      const { startX, startY } = calculateNextRowLayout();
      const newId = Date.now();
      const newAssetData = {
        asset_id: newId, asset_type: '3d', source_prompt: payload.prompt,
        parent_id: hasContext ? payload.context_assets[0].asset_id : null,
        file_url: null, x: startX, y: startY, width: 300, height: 300,
      };
      return { new_assets: [newAssetData] };
    }

    // 2. If NO generation command, check for CONTEXT. This implies an INQUIRY.
    if (hasContext) {
      // Get the IDs of ALL selected assets
      const selectedIds = payload.context_assets.map(asset => asset.asset_id);
      const idsString = selectedIds.join(', '); // Create a comma-separated list of IDs

      const mockResponse = `This is a mock AI description for the ${payload.context_assets.length} selected asset(s) with IDs: ${idsString}. You asked: "${payload.prompt}".`;
      
      // Return a MESSAGE, not a new asset.
      return { new_assets: [], message: mockResponse };
    }
    
    // 3. If none of the above, it's a command we don't understand.
    return { new_assets: [], message: `I can only answer questions about selected assets or generate new ones with @image or @3d.` };
  };

  /**
   * Central chat handler that builds context and calls the API.
   */
  const sendChat = async () => {
    const trimmedInput = chatInput.trim();
    if (trimmedInput === '') return;

    // Add user message to chat UI immediately
    const userMessage = { sender: 'user', text: trimmedInput };
    const tempMessageId = Date.now();
    setChatMessages((prev) => [...prev, userMessage, { sender: 'bot', text: 'Thinking...', id: tempMessageId }]);
    setChatInput('');

    // 1. Gather Context from selected assets
    const selectedIds = [...selectedImageIds, ...selectedModel3DIds];
    const context_assets = selectedIds.map(id => assetHistory[id]).filter(Boolean);

    // 2. Construct the Contextual Payload
    const contextualPayload = {
      prompt: trimmedInput,
      context_assets: context_assets,
    };

    // 3. Make the single, unified API Call
    const result = await mockApiCall(contextualPayload);

    // 4. Handle the Response (which can be assets OR a text message)
    if (result.new_assets && result.new_assets.length > 0) {
      const newAssets = result.new_assets;
      
      const newHistoryEntries = Object.fromEntries(newAssets.map(asset => [asset.asset_id, asset]));
      setAssetHistory(prev => ({ ...prev, ...newHistoryEntries }));

      const newImageIds = newAssets.filter(a => a.asset_type === 'image').map(a => a.asset_id);
      const new3DModelIds = newAssets.filter(a => a.asset_type === '3d').map(a => a.asset_id);

      if (newImageIds.length > 0) setImagePlaceholderIds(prev => [...prev, ...newImageIds]);
      if (new3DModelIds.length > 0) setModel3DPlaceholderIds(prev => [...prev, ...new3DModelIds]);
      
      setChatMessages(prev => prev.map(msg => 
        msg.id === tempMessageId ? { sender: 'bot', text: `✨ Created ${newAssets.length} new asset(s)!` } : msg
      ));

    } else {
      // Handle cases where a text message was returned instead of an asset
      setChatMessages(prev => prev.map(msg => 
        msg.id === tempMessageId ? { sender: 'bot', text: result.message } : msg
      ));
    }
  };

  // --- REFINED & RENAMED for clarity ---
  /**
   * Calculates the starting layout for a new row of elements.
   */
  const calculateNextRowLayout = () => {
    const canvas = canvasRef.current;
    if (!canvas) return { startX: 0, startY: 0 };
    
    const allAssetIds = [...imagePlaceholderIds, ...model3DPlaceholderIds];
    const allPlaceholders = allAssetIds.map(id => assetHistory[id]);

    const placeholderHeight = 300;
    const rowMargin = 20;

    if (allPlaceholders.length === 0) {
      const chatPanelWidth = 600;
      const placeholderWidth = 300;
      const visibleCanvasWidth = canvas.clientWidth - chatPanelWidth;
      const screenCenterX = visibleCanvasWidth / 2;
      const screenCenterY = canvas.clientHeight / 2;
      const worldCenterX = (screenCenterX - offset.x) / scale;
      const worldCenterY = (screenCenterY - offset.y) / scale;
      return { startX: worldCenterX - placeholderWidth / 2, startY: worldCenterY - placeholderHeight / 2 };
    } else {
      const startX = Math.min(...allPlaceholders.map(p => p.x));
      const maxY = Math.max(...allPlaceholders.map(p => p.y));
      const startY = maxY + placeholderHeight + rowMargin;
      return { startX, startY };
    }
  };

  
  // --- Canvas Interaction Handlers ---
  const handleMouseDown = (e) => {
    if (!canvasRef.current || e.target !== canvasRef.current) return;
    
    // Clear all selections on canvas click
    setSelectedImageIds([]);
    setSelectedModel3DIds([]);
    
    setIsDragging(true);
    setStartDrag({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // --- (handleMouseMove, handleMouseUp, handleWheel functions remain the same) ---
  const handleMouseMove = (e) => {
    if (activeTool === 'rectangle' && drawingRect) {
      const rect = canvasRef.current.getBoundingClientRect();
      const currentX = (e.clientX - rect.left - offset.x) / scale;
      const currentY = (e.clientY - rect.top - offset.y) / scale;
      const width = currentX - drawingRect.x;
      const height = currentY - drawingRect.y;
      setDrawingRect({ ...drawingRect, width, height });
      return;
    }

    if (draggingTextId !== null) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - offset.x) / scale;
      const mouseY = (e.clientY - rect.top - offset.y) / scale;
      setTextBlocks((prev) =>
        prev.map((tb) =>
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
    setIsDragging(false);

    if (activeTool === 'rectangle' && drawingRect) {
      const id = Date.now();
      const finalRect = {
        id,
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

    setDraggingTextId(null);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    latestWheelEvent.current = e;

    if (zoomAnimationFrame.current) return;

    zoomAnimationFrame.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas || !latestWheelEvent.current) return;

      const evt = latestWheelEvent.current;
      const rect = canvas.getBoundingClientRect();
      const mouseX = evt.clientX - rect.left;
      const mouseY = evt.clientY - rect.top;

      const zoomFactor = 0.1;
      const direction = evt.deltaY < 0 ? 1 : -1;
      const nextScale = scale + direction * zoomFactor;
      const newScale = Math.min(Math.max(nextScale, 0.2), 3);

      const worldX = (mouseX - offset.x) / scale;
      const worldY = (mouseY - offset.y) / scale;

      const newOffsetX = mouseX - worldX * newScale;
      const newOffsetY = mouseY - worldY * newScale;

      setScale(newScale);
      setOffset({ x: newOffsetX, y: newOffsetY });

      zoomAnimationFrame.current = null;
      latestWheelEvent.current = null;
    });
  };

  // --- SVG Export ---
  const exportAsSVG = () => {
    const allElements = [
        ...shapes,
        ...textBlocks.map(tb => ({ ...tb, width: 150, height: 30 })),
        ...imagePlaceholders,
        ...model3DPlaceholders // <-- MODIFIED: Include 3D models in export
    ];
    if (allElements.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allElements.forEach(el => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    });

    const padding = 40;
    minX -= padding; minY -= padding;
    maxX += padding; maxY += padding;

    const width = maxX - minX;
    const height = maxY - minY;

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">`;
    svgContent += `<style>.text-content { font-family: sans-serif; font-size: 14px; fill: black; }</style>`;

    shapes.forEach(shape => {
      svgContent += `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="rgba(14, 165, 233, 0.05)" stroke="#333" stroke-width="2"/>`;
    });

    imagePlaceholders.forEach(img => {
      svgContent += `<g transform="translate(${img.x}, ${img.y})"><rect width="${img.width}" height="${img.height}" fill="#f3f4f6" stroke="#d1d5db" stroke-width="2"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="20" fill="#9ca3af">🖼️</text></g>`;
    });
    
    // NEW: Add 3D model placeholders to SVG export
    model3DPlaceholders.forEach(model => {
      svgContent += `<g transform="translate(${model.x}, ${model.y})"><rect width="${model.width}" height="${model.height}" fill="#f3f4f6" stroke="#d1d5db" stroke-width="2"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="20" fill="#9ca3af">🧊</text></g>`;
    });

    textBlocks.forEach(tb => {
      svgContent += `<text x="${tb.x}" y="${tb.y + 14}" class="text-content">${tb.text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text>`;
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
      if (zoomAnimationFrame.current) {
        cancelAnimationFrame(zoomAnimationFrame.current);
      }
    };
  }, [scale, offset]);

  useEffect(() => {
    if (chatInputRef.current) {
      chatInputRef.current.style.height = 'auto';
      chatInputRef.current.style.height = `${chatInputRef.current.scrollHeight}px`;
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
        <div className="header-left"><h1>Agentic Prompt-based Interface</h1></div>
        <div className="header-right"><button className="save-button" onClick={exportAsSVG}>Export SVG</button></div>
      </header>
      <div className="app-body">
        <main
          className="app-main"
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{
            backgroundPosition: `${offset.x % 40}px ${offset.y % 40}px`,
            backgroundSize: `${40 * scale}px ${40 * scale}px`,
            cursor: activeTool === 'rectangle' ? 'crosshair' : activeTool === 'text' ? 'text' : 'grab',
          }}
        >
          <div
            className="canvas-content-wrapper"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              pointerEvents: 'none',
            }}>
            {/* --- REFACTORED: Render loops now use IDs and lookup from assetHistory --- */}
            {imagePlaceholderIds.map((id) => {
              const asset = assetHistory[id];
              if (!asset) return null;
              return (
                <div
                  key={id}
                  className={`canvas-image-placeholder ${selectedImageIds.includes(id) ? 'selected' : ''}`}
                  style={{
                    left: asset.x, top: asset.y,
                    width: asset.width, height: asset.height,
                    pointerEvents: 'auto',
                    backgroundImage: `url(${asset.file_url})`, // Use the image from the URL
                    backgroundSize: 'cover',
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setSelectedImageIds((prevIds) =>
                      prevIds.includes(id) ? prevIds.filter((pId) => pId !== id) : [...prevIds, id]
                    );
                  }}
                >
                  <button
                    className="close-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setImagePlaceholderIds((prev) => prev.filter((pId) => pId !== id));
                      setSelectedImageIds((prev) => prev.filter((pId) => pId !== id));
                      setAssetHistory(prev => {
                          const newHistory = {...prev};
                          delete newHistory[id];
                          return newHistory;
                      });
                    }}
                    style={{ top: '4px', right: '4px' }}
                  >×</button>
                  {/* Content can be an overlay if needed */}
                </div>
              );
            })}
            
            {/* --- NEW: Render 3D Model Placeholders --- */}
            {model3DPlaceholderIds.map((id) => {
                const asset = assetHistory[id];
                if (!asset) return null;
                return (
                    <div
                      key={id}
                      className={`canvas-model3d-placeholder ${selectedModel3DIds.includes(id) ? 'selected' : ''}`}
                      style={{
                          left: asset.x, top: asset.y,
                          width: asset.width, height: asset.height,
                          pointerEvents: 'auto',
                      }}
                      onMouseDown={(e) => {
                          e.stopPropagation();
                          setSelectedModel3DIds((prevIds) =>
                              prevIds.includes(id) ? prevIds.filter((pId) => pId !== id) : [...prevIds, id]
                          );
                      }}
                    >
                      <button
                        className="close-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setModel3DPlaceholderIds((prev) => prev.filter((pId) => pId !== id));
                          setSelectedModel3DIds((prev) => prev.filter((pId) => pId !== id));
                          setAssetHistory(prev => {
                              const newHistory = {...prev};
                              delete newHistory[id];
                              return newHistory;
                          });
                        }}
                        style={{ top: '4px', right: '4px' }}
                      >×</button>
                      <div className="placeholder-content">
                          <span>🧊</span>
                          <p>3D Model</p>
                          <small title={asset.source_prompt}>{asset.source_prompt}</small>
                      </div>
                    </div>
                );
            })}

            {/* --- (shapes and textBlocks rendering remains the same) --- */}
            {shapes.map((shape) => (
              <div
                key={shape.id}
                className="canvas-shape-final"
                style={{
                  left: shape.x, top: shape.y,
                  width: shape.width, height: shape.height,
                  pointerEvents: 'auto',
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  const move = (event) => {
                    const deltaX = event.movementX / scale;
                    const deltaY = event.movementY / scale;
                    setShapes((prev) =>
                      prev.map((s) =>
                        s.id === shape.id ? { ...s, x: s.x + deltaX, y: s.y + deltaY } : s
                      )
                    );
                  };
                  const up = () => window.removeEventListener('mousemove', move);
                  window.addEventListener('mousemove', move);
                  window.addEventListener('mouseup', up, { once: true });
                }}
              >
                <button
                  className="close-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShapes((prev) => prev.filter((s) => s.id !== shape.id));
                  }}
                  style={{ top: '-10px', right: '-10px' }}
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
                      setShapes((prev) =>
                        prev.map((s) =>
                          s.id === shape.id
                            ? { ...s, width: Math.max(20, startWidth + dx), height: Math.max(20, startHeight + dy) }
                            : s
                        )
                      );
                    };
                    const stopResize = () => window.removeEventListener('mousemove', resize);
                    window.addEventListener('mousemove', resize);
                    window.addEventListener('mouseup', stopResize, { once: true });
                  }}
                />
              </div>
            ))}
            {textBlocks.map((tb) => (
              <div
                key={tb.id}
                className="text-block-container"
                style={{
                  position: 'absolute', left: tb.x, top: tb.y,
                  pointerEvents: 'auto',
                }}
              >
                <button
                  className="close-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTextBlocks((prev) => prev.filter((b) => b.id !== tb.id));
                  }}
                  style={{ position: 'absolute', top: '-10px', right: '-10px', zIndex: 20 }}
                >×</button>
                <textarea
                  className="canvas-text-block"
                  value={tb.text}
                  onChange={(e) =>
                    setTextBlocks((prev) =>
                      prev.map((b) => (b.id === tb.id ? { ...b, text: e.target.value } : b))
                    )
                  }
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    const rect = canvasRef.current.getBoundingClientRect();
                    const offsetX = (e.clientX - rect.left - offset.x) / scale - tb.x;
                    const offsetY = (e.clientY - rect.top - offset.y) / scale - tb.y;
                    setDraggingTextId(tb.id);
                    setTextDragOffset({ x: offsetX, y: offsetY });
                  }}
                />
              </div>
            ))}
            {drawingRect && (
              <div
                className="canvas-shape-preview"
                style={{
                  left: drawingRect.width < 0 ? drawingRect.x + drawingRect.width : drawingRect.x,
                  top: drawingRect.height < 0 ? drawingRect.y + drawingRect.height : drawingRect.y,
                  width: Math.abs(drawingRect.width),
                  height: Math.abs(drawingRect.height),
                }}
              />
            )}
          </div>
          <div className="canvas-label"></div>
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
              placeholder="1. '@image', '@2image', '@3image' to generate image... 2. '@3d' to generate 3d... 3. Select an asset and type a command..."
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

        <div className="canvas-toolbar">
            <button title="Mouse Tool" className={`toolbar-button ${activeTool === 'mouse' ? 'active' : ''}`} onClick={() => setActiveTool('mouse')}>
                <img src="/icons/mouse.png" alt="Mouse Tool" />
            </button>
            <button title="Rectangle Tool" className={`toolbar-button ${activeTool === 'rectangle' ? 'active' : ''}`} onClick={() => setActiveTool('rectangle')}>
                <img src="/icons/rectangle.png" alt="Rectangle Tool" />
            </button>
            <button title="Text Tool" className={`toolbar-button ${activeTool === 'text' ? 'active' : ''}`} onClick={() => setActiveTool('text')}>
                <img src="/icons/text.png" alt="Text Tool" />
            </button>
        </div>
      </div>
    </div>
  );
}

export default App;
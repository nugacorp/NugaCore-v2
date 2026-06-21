import React, { useState, useRef, useEffect } from 'react';
import { 
  Wrench, 
  Search, 
  MessageSquare, 
  CheckCircle, 
  AlertTriangle, 
  User, 
  Calendar, 
  Phone, 
  FileText, 
  MapPin, 
  CheckSquare, 
  PenTool, 
  Maximize2
} from 'lucide-react';
import { Ticket, TaskOrder, Client } from '../types';

interface SupportModuleProps {
  tickets: Ticket[];
  workOrders: TaskOrder[];
  clients: Client[];
  onAddTicket: (ticketData: any) => Promise<void>;
  onPostTicketMessage: (id: string, text: string) => Promise<void>;
  onUpdateWorkOrderStatus: (id: string, status: string, signature?: string, checklist?: any[]) => Promise<void>;
}

export default function SupportModule({ 
  tickets, 
  workOrders, 
  clients, 
  onAddTicket, 
  onPostTicketMessage, 
  onUpdateWorkOrderStatus 
}: SupportModuleProps) {
  const [activeSubView, setActiveSubView] = useState<'tickets' | 'orders'>('tickets');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<TaskOrder | null>(null);

  // Form State
  const [showAddTicket, setShowAddTicket] = useState(false);
  const [formClientId, setFormClientId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState<'Internet' | 'Facturacion' | 'Instalacion' | 'Falla Red' | 'Otro'>('Internet');
  const [formSeverity, setFormSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');

  // Ticket Reply
  const [replyMessage, setReplyMessage] = useState('');
  const [ticketQuery, setTicketQuery] = useState('');

  // Canvas Drawing Pad State
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Start checklist drawing
  useEffect(() => {
    if (selectedOrder && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#a5b4fc'; // Light Indigo
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        // Clear background
        ctx.fillStyle = '#090d16'; // darker slate
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, [selectedOrder, activeSubView]);

  useEffect(() => {
    if (!selectedTicket) return;
    const freshTicket = tickets.find(t => t.id === selectedTicket.id);
    if (!freshTicket) {
      setSelectedTicket(null);
      return;
    }
    if (freshTicket !== selectedTicket) {
      setSelectedTicket(freshTicket);
    }
  }, [tickets, selectedTicket]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    draw(e);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.beginPath();
    }
  };

  const clearSignature = () => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  const handleTicketSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClientId || !formTitle) return;

    await onAddTicket({
      clientId: formClientId,
      title: formTitle,
      description: formDesc,
      category: formCategory,
      severity: formSeverity
    });

    setShowAddTicket(false);
    setFormTitle('');
    setFormDesc('');
  };

  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyMessage.trim() || !selectedTicket) return;

    await onPostTicketMessage(selectedTicket.id, replyMessage.trim());
    setReplyMessage('');
    // Refresh selected element
    const freshTicket = tickets.find(t => t.id === selectedTicket.id);
    if (freshTicket) setSelectedTicket(freshTicket);
  };

  const handleWorkOrderChecklistToggle = async (order: TaskOrder, itemIdx: number) => {
    const updatedChecklist = [...order.checklist];
    updatedChecklist[itemIdx].done = !updatedChecklist[itemIdx].done;

    await onUpdateWorkOrderStatus(order.id, order.status, undefined, updatedChecklist);
    // Refresh selected context
    const freshOrder = workOrders.find(w => w.id === order.id);
    if (freshOrder) setSelectedOrder(freshOrder);
  };

  const handleCompleteWorkOrder = async (order: TaskOrder) => {
    let signatureBase64 = undefined;
    if (canvasRef.current) {
      signatureBase64 = canvasRef.current.toDataURL();
    }

    await onUpdateWorkOrderStatus(order.id, 'completed', signatureBase64, order.checklist);
    setSelectedOrder(null);
  };

  const normalizedTicketQuery = ticketQuery.trim().toLowerCase();
  const filteredTickets = tickets.filter((ticket) => {
    if (!normalizedTicketQuery) return true;
    const searchable = [ticket.title, ticket.description, ticket.clientName, ticket.category, ticket.status].join(' ').toLowerCase();
    return searchable.includes(normalizedTicketQuery);
  });

  const selectedTicketData = selectedTicket ? tickets.find(t => t.id === selectedTicket.id) || selectedTicket : null;
  const selectedTicketClient = selectedTicketData?.clientId
    ? clients.find(client => client.id === selectedTicketData.clientId)
    : null;

  const activeTicketCount = tickets.filter(t => t.status === 'open' || t.status === 'assigned').length;

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      {/* Header sub navig */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <Wrench className="w-6 h-6 text-indigo-400" />
            <span>Mesa de Ayuda & Órdenes de Trabajo</span>
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Canaliza fallas de abonados con SLAs inteligentes y despacha técnicos instaladores a terreno con bitácoras digitales.
          </p>
        </div>
        
        <div className="flex bg-slate-950 p-1 border border-slate-800 rounded-xl space-x-1 self-start">
          <button
            onClick={() => setActiveSubView('tickets')}
            className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg transition ${
              activeSubView === 'tickets' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Tickets Soporte
          </button>
          <button
            onClick={() => setActiveSubView('orders')}
            id="orders-technical-subtab"
            className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg transition ${
              activeSubView === 'orders' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Orden Trabajo (Técnicos)
          </button>
        </div>
      </div>

      {activeSubView === 'tickets' ? (
        <div id="ticket-workspace-view" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Ticket list panel */}
          <div className="lg:col-span-4 bg-slate-950 p-5 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-900 pb-4">
              <div>
                <span className="text-sm font-bold text-white tracking-wide block">Buzón de Averías</span>
                <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">
                  {activeTicketCount} activos
                </span>
              </div>
              <button
                onClick={() => setShowAddTicket(true)}
                id="create-new-ticket-btn"
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3.5 py-1.5 rounded-lg font-mono transition"
              >
                Levantar Ticket
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={ticketQuery}
                onChange={(e) => setTicketQuery(e.target.value)}
                placeholder="Buscar tickets, cliente o categoría..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="space-y-3 max-h-[470px] overflow-y-auto pr-1">
              {filteredTickets.map((tk) => (
                <div
                  key={tk.id}
                  id={`ticket-box-item-${tk.id}`}
                  onClick={() => setSelectedTicket(tk)}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition flex items-start justify-between gap-3 ${
                    selectedTicketData?.id === tk.id
                      ? 'bg-slate-900 border-indigo-500/50'
                      : 'bg-slate-900/40 border-slate-900 hover:border-slate-800'
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center space-x-2 min-w-0">
                      <span className="font-bold text-white text-sm truncate">{tk.title}</span>
                      <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-1.5 py-0.2 rounded font-mono font-bold uppercase tracking-wider shrink-0">
                        {tk.category}
                      </span>
                    </div>
                    <p className="text-slate-400 font-sans text-xs line-clamp-1">{tk.description}</p>
                    <div className="text-[10px] font-mono text-slate-500 truncate">
                      {tk.clientName} | SLA: {tk.slaHours}h
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    {tk.status === 'open' && (
                      <span className="bg-rose-500/15 text-rose-400 border border-rose-500/20 text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase">
                        Open
                      </span>
                    )}
                    {tk.status === 'assigned' && (
                      <span className="bg-amber-500/15 text-amber-400 border border-amber-500/20 text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase">
                        Assigned
                      </span>
                    )}
                    {tk.status === 'resolved' && (
                      <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase">
                        Resolved
                      </span>
                    )}
                    {tk.status === 'closed' && (
                      <span className="bg-slate-800 text-slate-300 border border-slate-700 text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase">
                        Closed
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {filteredTickets.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 py-8 text-center">
                  <p className="text-xs text-slate-500 font-mono">No se encontraron tickets con ese criterio.</p>
                </div>
              )}
            </div>
          </div>

          {/* Conversation panel */}
          <div className="lg:col-span-5">
            {selectedTicketData ? (
              <div id="ticket-chat-pane" className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-4 flex flex-col justify-between h-[560px]">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-3">
                    <div>
                      <span className="text-[9px] text-indigo-400 font-mono uppercase tracking-widest block font-bold">Ticket Conversation</span>
                      <h4 className="text-sm font-bold text-white line-clamp-1">{selectedTicketData.title}</h4>
                    </div>
                    <button onClick={() => setSelectedTicket(null)} className="text-slate-500 hover:text-white font-bold">✕</button>
                  </div>

                  <div className="space-y-3 h-[380px] overflow-y-auto pr-1 text-xs font-mono">
                    {selectedTicketData.messages.map((m, idx) => (
                      <div key={idx} className={`space-y-1 ${m.sender === 'Cliente' ? 'text-left' : 'text-right'}`}>
                        <span className="text-[9px] text-slate-500 font-bold block">{m.sender} • {m.date}</span>
                        <div className={`p-2.5 rounded-xl inline-block max-w-[92%] leading-relaxed ${
                          m.sender === 'Cliente'
                            ? 'bg-slate-900 border border-slate-800 text-slate-300 text-left'
                            : 'bg-indigo-600 text-white text-left'
                        }`}>
                          <span>{m.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleReplySubmit} className="flex gap-2 border-t border-slate-900 pt-3">
                  <input
                    type="text"
                    required
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    placeholder="Responder al cliente..."
                    className="flex-1 bg-slate-900 border border-slate-800/80 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    id="submit-ticket-reply-btn"
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-2 rounded-xl text-xs transition"
                  >
                    Enviar
                  </button>
                </form>
              </div>
            ) : (
              <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 text-center py-16 text-slate-500 font-mono h-[560px] flex flex-col justify-center">
                <MessageSquare className="w-12 h-12 text-slate-800 mx-auto mb-3" />
                <p className="text-sm">Selecciona un ticket para abrir la conversación y documentar resolución.</p>
              </div>
            )}
          </div>

          {/* Active ticket context sidebar */}
          <div className="lg:col-span-3">
            {selectedTicketData ? (
              <div id="ticket-context-sidebar" className="bg-slate-950 p-5 rounded-3xl border border-slate-800 space-y-4 h-[560px] overflow-y-auto">
                <div className="border-b border-slate-900 pb-3">
                  <span className="text-[9px] text-emerald-400 font-mono uppercase tracking-widest block font-bold">Active Ticket</span>
                  <p className="text-sm text-white font-semibold mt-1 line-clamp-2">{selectedTicketData.title}</p>
                </div>

                <div className="space-y-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Estado</span>
                  <div>
                    {selectedTicketData.status === 'open' && (
                      <span className="bg-rose-500/15 text-rose-400 border border-rose-500/20 text-[10px] font-mono px-2 py-1 rounded-lg font-bold uppercase">Open</span>
                    )}
                    {selectedTicketData.status === 'assigned' && (
                      <span className="bg-amber-500/15 text-amber-400 border border-amber-500/20 text-[10px] font-mono px-2 py-1 rounded-lg font-bold uppercase">Assigned</span>
                    )}
                    {selectedTicketData.status === 'resolved' && (
                      <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-[10px] font-mono px-2 py-1 rounded-lg font-bold uppercase">Resolved</span>
                    )}
                    {selectedTicketData.status === 'closed' && (
                      <span className="bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-mono px-2 py-1 rounded-lg font-bold uppercase">Closed</span>
                    )}
                  </div>
                </div>

                <div className="space-y-2 bg-slate-900/40 border border-slate-900 rounded-xl p-3">
                  <div className="flex items-center space-x-2 text-slate-300 text-xs">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span>Severidad: <strong className="uppercase">{selectedTicketData.severity}</strong></span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono">SLA objetivo: {selectedTicketData.slaHours} horas</p>
                </div>

                <div className="space-y-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Subscriber</span>
                  <div className="bg-slate-900/40 border border-slate-900 rounded-xl p-3 space-y-2">
                    <div className="flex items-center space-x-2 text-slate-200 text-xs">
                      <User className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{selectedTicketData.clientName}</span>
                    </div>
                    {selectedTicketClient?.phone && (
                      <div className="flex items-center space-x-2 text-slate-400 text-[11px]">
                        <Phone className="w-3.5 h-3.5" />
                        <span>{selectedTicketClient.phone}</span>
                      </div>
                    )}
                    {selectedTicketClient?.address && (
                      <div className="flex items-start space-x-2 text-slate-400 text-[11px]">
                        <MapPin className="w-3.5 h-3.5 mt-0.5" />
                        <span>{selectedTicketClient.address}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Timeline</span>
                  <div className="bg-slate-900/40 border border-slate-900 rounded-xl p-3 text-[11px] text-slate-400 space-y-1.5">
                    <div className="flex items-center space-x-2">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      <span>Creado: {selectedTicketData.created}</span>
                    </div>
                    {selectedTicketData.updatedAt && (
                      <div className="flex items-center space-x-2">
                        <Calendar className="w-3.5 h-3.5 text-slate-500" />
                        <span>Última actualización: {selectedTicketData.updatedAt}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 text-center py-16 text-slate-500 font-mono h-[560px] flex flex-col justify-center">
                <p className="text-sm">Aquí verás el contexto del ticket activo: estado, SLA y datos del abonado.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div id="technical-orders-view" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Work Orders collection (7 columns) */}
          <div className="lg:col-span-7 bg-slate-950 p-5 rounded-3xl border border-slate-800 space-y-4">
            <span className="text-sm font-bold text-white tracking-wide block mb-3 font-mono">Órdenes de Trabajo Despachadas</span>

            <div className="space-y-3 max-h-[420px] overflow-y-auto">
              {workOrders.map((wo) => (
                <div
                  key={wo.id}
                  id={`work-order-row-${wo.id}`}
                  onClick={() => setSelectedOrder(wo)}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition flex items-start justify-between ${
                    selectedOrder?.id === wo.id
                      ? 'bg-slate-900 border-indigo-500/50'
                      : 'bg-slate-900/40 border-slate-900 hover:border-slate-800'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white text-sm">{wo.title}</span>
                      <span className="bg-slate-800 text-slate-400 border border-slate-700 text-[10px] px-1.5 py-0.2 rounded font-mono font-bold uppercase tracking-wider">
                        {wo.type}
                      </span>
                    </div>
                    <div className="text-slate-400 text-xs">
                      Técnico: <span className="text-slate-300 font-semibold">{wo.technicianName}</span> | Fecha: {wo.date}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">Abonado receptor: {wo.clientName}</div>
                  </div>

                  <div className="text-right">
                    {wo.status === 'completed' ? (
                      <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-[9px] font-mono px-2 py-0.5 rounded-full uppercase font-bold text-right">
                        Instalada
                      </span>
                    ) : (
                      <span className="bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[9px] font-mono px-2 py-0.5 rounded-full uppercase font-bold text-right animate-pulse">
                        En Proceso
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Active Work Order detailing & Canvas signatures (5 columns) */}
          <div className="lg:col-span-5">
            {selectedOrder ? (
              <div id="work-order-detail-canvas" className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-5">
                <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                  <div>
                    <span className="text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded tracking-widest uppercase font-mono font-bold">
                      Detalle de Campo
                    </span>
                    <h4 className="text-sm font-bold text-white mt-1.5 line-clamp-1">{selectedOrder.title}</h4>
                  </div>
                  <button onClick={() => setSelectedOrder(null)} className="text-slate-500 hover:text-white font-bold">✕</button>
                </div>

                {/* Notes and Address details */}
                <div className="space-y-3.5 text-xs">
                  <div className="space-y-1.5">
                    <span className="text-slate-500 font-mono text-[9px] block uppercase">Ubicación Cliente</span>
                    <div className="flex items-start space-x-2 bg-slate-900/60 p-2.5 rounded-xl border border-slate-900">
                      <MapPin className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold block">{selectedOrder.clientName}</span>
                        <span className="text-slate-400 text-[11px] block">{selectedOrder.address}</span>
                      </div>
                    </div>
                  </div>

                  {/* Checklist loops */}
                  <div className="space-y-1.5">
                    <span className="text-slate-500 font-mono text-[9px] block uppercase">Checklist Técnico Obligatorio</span>
                    <div className="space-y-1">
                      {selectedOrder.checklist.map((item, idx) => (
                        <div 
                          key={idx}
                          role="button"
                          onClick={() => selectedOrder.status !== 'completed' && handleWorkOrderChecklistToggle(selectedOrder, idx)}
                          className={`flex items-center space-x-2 p-2 rounded-lg text-[11px] select-none transition border ${
                            item.done 
                              ? 'bg-indigo-900/15 border-indigo-500/30 text-indigo-200' 
                              : 'bg-slate-900/30 border-transparent hover:bg-slate-900/50 text-slate-400'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={item.done}
                            readOnly
                            className="rounded text-indigo-600 focus:ring-0"
                          />
                          <span className="flex-1 text-left leading-snug">{item.item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Canvas signature pad */}
                  {selectedOrder.status !== 'completed' ? (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500 font-mono text-[9px] uppercase flex items-center space-x-1">
                          <PenTool className="w-3 h-3 text-emerald-400" />
                          <span>Firma Digital Conformidad Abonado</span>
                        </span>
                        <button
                          type="button"
                          onClick={clearSignature}
                          className="text-[10px] text-slate-500 hover:text-slate-300 font-bold"
                        >
                          Limpiar Lienzo
                        </button>
                      </div>

                      <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950">
                        <canvas
                          ref={canvasRef}
                          width={320}
                          height={120}
                          onMouseDown={startDrawing}
                          onMouseMove={draw}
                          onMouseUp={stopDrawing}
                          onMouseLeave={stopDrawing}
                          className="w-full h-[120px] cursor-crosshair block"
                        />
                      </div>

                      <button
                        id="complete-work-order-trigger-btn"
                        onClick={() => handleCompleteWorkOrder(selectedOrder)}
                        className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold font-mono text-xs uppercase tracking-widest text-center transition block shadow-lg shadow-emerald-500/15"
                      >
                        Guardar & Cerrar Orden Trabajo
                      </button>
                    </div>
                  ) : (
                    <div className="bg-slate-900/60 p-4 rounded-xl text-center border border-slate-900/80">
                      <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                      <span className="font-mono text-xs font-bold text-white block">Orden Concretada con Éxito</span>
                      <span className="text-[10px] text-slate-500 font-mono block mt-0.5">Sello digital y firma validados en base de datos.</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 text-center py-12 text-slate-500 font-mono">
                <FileText className="w-12 h-12 text-slate-850 mx-auto mb-3" />
                <p className="text-sm">Selecciona una orden de trabajo de la grilla para checar los detalles de instalación y el pad de firma.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lift Ticket modal */}
      {showAddTicket && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-sm font-bold text-white font-mono flex items-center space-x-1.5">
                <span>Levantar Ticket Soporte</span>
              </h3>
              <button onClick={() => setShowAddTicket(false)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>

            <form onSubmit={handleTicketSubmit} className="space-y-4 text-xs font-mono">
              <div className="space-y-1">
                <label className="text-slate-400">Seleccionar Cliente</label>
                <select
                  required
                  value={formClientId}
                  onChange={(e) => setFormClientId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none"
                >
                  <option value="">-- Selecciona abonado --</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Asunto / Falla</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Lentitud severa en horas pico"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Categoría</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="Internet">Internet</option>
                    <option value="Facturacion">Facturacion</option>
                    <option value="Instalacion">Instalacion</option>
                    <option value="Falla Red">Falla Red</option>
                    <option value="Otro">Otro</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Severidad (SLA)</label>
                  <select
                    value={formSeverity}
                    onChange={(e) => setFormSeverity(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none"
                  >
                    <option value="low">Baja (24h)</option>
                    <option value="medium">Media (12h)</option>
                    <option value="high">Alta (4h)</option>
                    <option value="critical">Crítica (1h)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Descripción detallada</label>
                <textarea
                  required
                  placeholder="Reporte del cliente completo..."
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 h-20 focus:outline-none"
                />
              </div>

              <div className="border-t border-slate-900 pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddTicket(false)}
                  className="border border-slate-800 hover:bg-slate-900 text-slate-400 px-4 py-2 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  id="confirm-ticket-create-submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl font-bold"
                >
                  Agregar Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

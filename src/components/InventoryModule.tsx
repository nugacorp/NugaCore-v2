import React, { useState } from 'react';
import { Box, Search, Plus, ArrowLeftRight, Truck } from 'lucide-react';
import { WarehouseItem } from '../types';

interface InventoryModuleProps {
  inventory: WarehouseItem[];
  onMovement: (itemId: string, type: 'in' | 'out' | 'transfer', qty: number, toWarehouse?: string) => Promise<void>;
  onAddItem: (itemData: any) => Promise<void>;
}

export default function InventoryModule({ inventory, onMovement, onAddItem }: InventoryModuleProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterWarehouse, setFilterWarehouse] = useState('all');

  // Modal State
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<WarehouseItem | null>(null);
  const [moveType, setMoveType] = useState<'in' | 'out' | 'transfer'>('transfer');
  const [moveQty, setMoveQty] = useState('1');
  const [destWarehouse, setDestWarehouse] = useState<'Principal' | 'Torre Alfa' | 'Coche Tecnico 1' | 'Coche Tecnico 2'>('Coche Tecnico 1');

  // Add Item Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<'CPE' | 'Router' | 'Switch' | 'Antenna' | 'Fiber' | 'OLT' | 'Other'>('CPE');
  const [formModel, setFormModel] = useState('');
  const [formBrand, setFormBrand] = useState('');
  const [formQty, setFormQty] = useState('1');
  const [formWarehouse, setFormWarehouse] = useState<'Principal' | 'Torre Alfa' | 'Coche Tecnico 1' | 'Coche Tecnico 2'>('Principal');
  const [formSerials, setFormSerials] = useState('');

  const filteredInventory = inventory.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.model.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesWarehouse = filterWarehouse === 'all' || item.warehouse === filterWarehouse;
    return matchesSearch && matchesWarehouse;
  });

  const handleMoveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;

    await onMovement(selectedItem.id, moveType, Number(moveQty), moveType === 'transfer' ? destWarehouse : undefined);
    setShowMoveModal(false);
  };

  const handleAddItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName || !formModel || !formBrand) return;
    await onAddItem({
      name: formName,
      category: formCategory,
      model: formModel,
      brand: formBrand,
      qty: Number(formQty),
      warehouse: formWarehouse,
      serials: formSerials
    });
    setFormName('');
    setFormModel('');
    setFormBrand('');
    setFormQty('1');
    setFormSerials('');
    setShowAddModal(false);
  };

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      {/* Header Bento block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <Box className="w-6 h-6 text-indigo-400" />
            <span>Inventarios & Movimientos de Almacén</span>
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            ERP real de activos: bobinas de fibra drop, antenas Ubiquiti Litebeam, GPON ONUs, switches y routers core.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          id="btn-add-inventory-item"
          className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition shadow-lg shadow-indigo-600/15 cursor-pointer self-start md:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Añadir Artículo a Almacén</span>
        </button>
      </div>

      {/* Main Board */}
      <div className="bg-slate-950 p-5 rounded-3xl border border-slate-800 space-y-4">
        {/* Search controls */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar equipo por nombre o modelo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 gap-1">
            {['all', 'Principal', 'Torre Alfa', 'Coche Tecnico 1'].map((w) => (
              <button
                key={w}
                onClick={() => setFilterWarehouse(w)}
                className={`px-3 py-1 text-xs font-mono rounded-lg transition ${
                  filterWarehouse === w ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {w === 'all' ? 'Ver Todos (Almacenes)' : w}
              </button>
            ))}
          </div>
        </div>

        {/* Inventory grid mapping bento squares style */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
          {filteredInventory.map((item) => (
            <div
              key={item.id}
              id={`inventory-item-card-${item.id}`}
              className="bg-slate-900/40 hover:bg-slate-900/80 rounded-2xl border border-slate-850 p-4 flex flex-col justify-between transition group"
            >
              <div>
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded font-mono font-bold uppercase">
                      {item.category}
                    </span>
                    <h4 className="text-base font-bold text-white mt-1.5 leading-snug">{item.name}</h4>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">Modelo: {item.model} | {item.brand}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 font-mono block">En Stock</span>
                    <span className="text-2xl font-extrabold font-mono text-emerald-400 tracking-tight">{item.qty}</span>
                  </div>
                </div>

                <div className="mt-3 bg-slate-950 p-2.5 rounded-xl border border-slate-920 text-[10px] font-mono flex items-center justify-between text-slate-400">
                  <span className="flex items-center space-x-1">
                    <Truck className="w-3.5 h-3.5 text-slate-500" />
                    <span>Ubicación: <strong>{item.warehouse}</strong></span>
                  </span>
                </div>
              </div>

              {/* Stock movement selector shortcut inside the bento */}
              <button
                id={`inventory-move-btn-${item.id}`}
                onClick={() => {
                  setSelectedItem(item);
                  setShowMoveModal(true);
                }}
                className="mt-4 w-full py-1.5 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-900/90 text-slate-300 font-semibold font-mono text-[10px] uppercase tracking-wider transition flex items-center justify-center space-x-1"
              >
                <ArrowLeftRight className="w-3 h-3" />
                <span>Registrar Entrada/Salida/Traspaso</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Movement Modal */}
      {showMoveModal && selectedItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-sm font-bold text-white font-mono">Movimiento: {selectedItem.name}</h3>
              <button onClick={() => setShowMoveModal(false)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>

            <form onSubmit={handleMoveSubmit} className="space-y-4 text-xs font-mono">
              <div className="space-y-1">
                <label className="text-slate-400">Tipo de Control</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setMoveType('in')}
                    className={`py-1.5 rounded-lg text-[10px] font-bold border transition ${
                      moveType === 'in' ? 'bg-indigo-600 border-indigo-505 text-white' : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Entrada (+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMoveType('out')}
                    className={`py-1.5 rounded-lg text-[10px] font-bold border transition ${
                      moveType === 'out' ? 'bg-indigo-600 border-indigo-505 text-white' : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Salida (-)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMoveType('transfer')}
                    className={`py-1.5 rounded-lg text-[10px] font-bold border transition ${
                      moveType === 'transfer' ? 'bg-indigo-600 border-indigo-505 text-white' : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Traspaso (⇄)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Cantidad</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={moveQty}
                    onChange={(e) => setMoveQty(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                {moveType === 'transfer' && (
                  <div className="space-y-1">
                    <label className="text-slate-400">Destino</label>
                    <select
                      value={destWarehouse}
                      onChange={(e) => {
                        const val = e.target.value as any;
                        if (val !== selectedItem.warehouse) setDestWarehouse(val);
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 focus:outline-none"
                    >
                      <option value="Principal">Principal</option>
                      <option value="Torre Alfa">Torre Alfa</option>
                      <option value="Coche Tecnico 1">Coche Tecnico 1</option>
                      <option value="Coche Tecnico 2">Coche Tecnico 2</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-900 pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowMoveModal(false)}
                  className="border border-slate-800 hover:bg-slate-900 text-slate-400 px-4 py-2 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  id="confirm-inventory-movement"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl font-bold"
                >
                  Confirmar Registro
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Item Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-sm font-bold text-white font-mono flex items-center space-x-1.5">
                <Box className="w-4 h-4 text-indigo-400" />
                <span>Registrar Nuevo Artículo</span>
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white font-bold text-sm">✕</button>
            </div>

            <form onSubmit={handleAddItemSubmit} className="space-y-4 text-xs font-mono">
              <div className="space-y-1">
                <label className="text-slate-400">Nombre del Artículo</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Antena LiteBeam 5AC Gen2 o ONU ZTE F670L"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Marca</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Ubiquiti, Huawei, Mikrotik"
                    value={formBrand}
                    onChange={(e) => setFormBrand(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400">Modelo</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: LBE-5AC, EG8145V5"
                    value={formModel}
                    onChange={(e) => setFormModel(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Categoría</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="CPE">CPE (Antena Cliente)</option>
                    <option value="Router">Router (MikroTik/Ubiquiti)</option>
                    <option value="Switch">Switch (Red Distribución)</option>
                    <option value="Antenna">Antenna Sectorial</option>
                    <option value="Fiber">Bobina de Fibra / Planta Externa</option>
                    <option value="OLT">OLT GPON Chassis</option>
                    <option value="Other">Otro Equipo/Accesorio</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400">Almacén Ubicación Inicial</label>
                  <select
                    value={formWarehouse}
                    onChange={(e) => setFormWarehouse(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none"
                  >
                    <option value="Principal">Almacén Principal</option>
                    <option value="Torre Alfa">Torre Alfa</option>
                    <option value="Coche Tecnico 1">Coche Técnico Móvil 1</option>
                    <option value="Coche Tecnico 2">Coche Técnico Móvil 2</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1 space-y-1">
                  <label className="text-slate-400">Cantidad Inicial</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={formQty}
                    onChange={(e) => setFormQty(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="col-span-2 space-y-1">
                  <label className="text-slate-400">Números de Serie (seriales)</label>
                  <input
                    type="text"
                    placeholder="Separados por coma, ej: SN1, SN2"
                    value={formSerials}
                    onChange={(e) => setFormSerials(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 text-[10px]"
                  />
                </div>
              </div>

              <div className="border-t border-slate-900 pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="border border-slate-800 hover:bg-slate-900 text-slate-400 px-4 py-2 rounded-xl transition duration-150"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  id="btn-confirm-add-item"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl font-bold font-mono transition duration-150"
                >
                  Registrar Artículo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

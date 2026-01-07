import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';

const App = () => {
  const [rawProducts, setRawProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSuppliers, setSelectedSuppliers] = useState(new Set());
  const [globalMarkup, setGlobalMarkup] = useState(20);
  const [itemMarkups, setItemMarkups] = useState({});
  const [selectedPrices, setSelectedPrices] = useState({}); // Manual price selection per item
  const [expandedItems, setExpandedItems] = useState(new Set()); // Items with expanded price details
  const [searchTerm, setSearchTerm] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showUnselected, setShowUnselected] = useState(false);
  const [selectedForExport, setSelectedForExport] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [priceStrategy, setPriceStrategy] = useState('min'); // min, max, avg, last

  const parseExcel = (file) => {
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        let headerRow = 0;
        for (let i = 0; i < Math.min(20, json.length); i++) {
          if (json[i] && json[i].some(cell => cell && String(cell).includes('Cod extern'))) {
            headerRow = i;
            break;
          }
        }
        
        const headers = json[headerRow];
        const colIndexes = {
          codExtern: headers.findIndex(h => h && String(h).includes('Cod extern')),
          denumire: headers.findIndex(h => h && String(h).includes('Denumire')),
          cantitate: headers.findIndex(h => h && String(h).includes('Cantitate')),
          pretUnitar: headers.findIndex(h => h && String(h).includes('Pret unitar')),
          valoare: headers.findIndex(h => h && String(h).includes('Valoare')),
          gestiune: headers.findIndex(h => h && String(h).includes('Gestiune')),
          furnizor: headers.findIndex(h => h && String(h).includes('Furnizor')),
          dataIntrare: -1,
        };
        
        // Căutăm coloana de dată
        for (let i = 0; i < headers.length; i++) {
          const h = headers[i];
          if (h) {
            const hStr = String(h).toLowerCase();
            if (hStr.includes('ultima data') || hStr.includes('data intrare')) {
              colIndexes.dataIntrare = i;
              break;
            }
          }
        }
        
        // Fallback: dacă găsim "Cod extern" la 0, data e probabil la 18
        if (colIndexes.dataIntrare === -1 && colIndexes.codExtern === 0 && headers.length > 18) {
          colIndexes.dataIntrare = 18;
          console.log('Fallback: folosim coloana 18 pentru dată');
        }
        
        console.log('Coloane finale:', colIndexes);
        
        // Verificăm primul rând de date
        if (json[headerRow + 1]) {
          const firstDataRow = json[headerRow + 1];
          console.log('Lungime primul rând:', firstDataRow.length);
          console.log('Valoare la index 18:', firstDataRow[18], 'Tip:', typeof firstDataRow[18]);
          
          // Verificăm toate valorile non-empty din primul rând
          const nonEmpty = firstDataRow.map((v, i) => v ? `[${i}]=${v}` : null).filter(Boolean);
          console.log('Valori non-empty:', nonEmpty.slice(-5).join(', ')); // ultimele 5
        }
        
        const parsed = [];
        const supplierSet = new Set();
        
        for (let i = headerRow + 1; i < json.length; i++) {
          const row = json[i];
          if (!row || !row[colIndexes.denumire]) continue;
          
          const supplier = row[colIndexes.furnizor] ? String(row[colIndexes.furnizor]).trim() : 'Necunoscut';
          supplierSet.add(supplier);
          
          // Parsăm data intrării
          let dataIntrare = null;
          if (colIndexes.dataIntrare >= 0) {
            const rawDate = row[colIndexes.dataIntrare];
            if (rawDate) {
              try {
                if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
                  dataIntrare = rawDate;
                } else if (typeof rawDate === 'number' && rawDate > 0) {
                  // Excel serial date (days since 1900-01-01)
                  const d = new Date((rawDate - 25569) * 86400 * 1000);
                  if (!isNaN(d.getTime())) dataIntrare = d;
                } else if (typeof rawDate === 'string' && rawDate.trim()) {
                  const parsed = new Date(rawDate.trim());
                  if (!isNaN(parsed.getTime())) dataIntrare = parsed;
                }
              } catch (e) {}
            }
          }
          
          parsed.push({
            rowId: i,
            codExtern: row[colIndexes.codExtern] ? String(row[colIndexes.codExtern]).trim() : '',
            denumire: String(row[colIndexes.denumire]).trim(),
            cantitate: Number(row[colIndexes.cantitate]) || 0,
            pretIntrare: Number(row[colIndexes.pretUnitar]) || 0,
            valoare: Number(row[colIndexes.valoare]) || 0,
            furnizor: supplier,
            dataIntrare: dataIntrare,
          });
        }
        
        const sortedSuppliers = Array.from(supplierSet).sort();
        
        // Numărăm câte intrări au date
        const withDates = parsed.filter(p => p.dataIntrare !== null).length;
        console.log(`Găsite ${withDates} intrări cu dată din ${parsed.length} total`);
        
        setRawProducts(parsed);
        setSuppliers(sortedSuppliers);
        setSelectedSuppliers(new Set(sortedSuppliers));
        setFileName(`${file.name} (${parsed.length} intrări, ${withDates} cu dată)`);
        setItemMarkups({});
        setSelectedForExport(new Set());
        setSelectedPrices({});
        
      } catch (err) {
        alert('Eroare la citirea fișierului: ' + err.message);
      }
      setLoading(false);
    };
    reader.readAsArrayBuffer(file);
  };

  // Grupează produsele după cod
  const groupedProducts = useMemo(() => {
    const groups = {};
    
    rawProducts.forEach(p => {
      if (!selectedSuppliers.has(p.furnizor)) return;
      
      const key = p.codExtern || p.denumire; // Folosim denumirea ca fallback dacă nu e cod
      if (!groups[key]) {
        groups[key] = {
          codExtern: p.codExtern,
          denumire: p.denumire,
          entries: []
        };
      }
      groups[key].entries.push({
        pretIntrare: p.pretIntrare,
        cantitate: p.cantitate,
        valoare: p.valoare,
        furnizor: p.furnizor,
        rowId: p.rowId,
        dataIntrare: p.dataIntrare
      });
    });
    
    return Object.values(groups).map(g => {
      const prices = g.entries.map(e => e.pretIntrare).filter(p => p > 0);
      const uniquePrices = [...new Set(prices)].sort((a, b) => a - b);
      const totalQty = g.entries.reduce((sum, e) => sum + e.cantitate, 0);
      const totalVal = g.entries.reduce((sum, e) => sum + e.valoare, 0);
      const suppliers = [...new Set(g.entries.map(e => e.furnizor))];
      
      // Găsim ultima intrare (data cea mai recentă)
      const entriesWithDate = g.entries.filter(e => e.dataIntrare);
      let lastEntry;
      if (entriesWithDate.length > 0) {
        lastEntry = entriesWithDate.reduce((max, e) => 
          e.dataIntrare > max.dataIntrare ? e : max, entriesWithDate[0]);
      } else {
        // Fallback la rowId dacă nu avem date
        lastEntry = g.entries.reduce((max, e) => e.rowId > max.rowId ? e : max, g.entries[0]);
      }
      const lastEntryPrice = lastEntry ? lastEntry.pretIntrare : 0;
      const lastEntryDate = lastEntry ? lastEntry.dataIntrare : null;
      
      let basePrice = 0;
      if (prices.length > 0) {
        // Check if there's a manually selected price for this item
        const manualPrice = selectedPrices[g.codExtern || g.denumire];
        if (manualPrice !== undefined && prices.includes(manualPrice)) {
          basePrice = manualPrice;
        } else {
          switch (priceStrategy) {
            case 'min': basePrice = Math.min(...prices); break;
            case 'max': basePrice = Math.max(...prices); break;
            case 'avg': basePrice = prices.reduce((a, b) => a + b, 0) / prices.length; break;
            case 'last': basePrice = lastEntryPrice; break;
            default: basePrice = Math.min(...prices);
          }
        }
      }
      
      return {
        ...g,
        uniquePrices,
        allPrices: prices,
        lastEntryPrice,
        lastEntryDate,
        lastEntry,
        // Group entries by price with details, păstrăm data pentru a marca ultima intrare
        priceDetails: g.entries.reduce((acc, e) => {
          const priceKey = e.pretIntrare.toFixed(2);
          if (!acc[priceKey]) {
            acc[priceKey] = { price: e.pretIntrare, entries: [], maxDate: e.dataIntrare };
          }
          acc[priceKey].entries.push({
            furnizor: e.furnizor,
            cantitate: e.cantitate,
            valoare: e.valoare,
            rowId: e.rowId,
            dataIntrare: e.dataIntrare
          });
          // Păstrăm cea mai recentă dată pentru acest preț
          if (e.dataIntrare && (!acc[priceKey].maxDate || e.dataIntrare > acc[priceKey].maxDate)) {
            acc[priceKey].maxDate = e.dataIntrare;
          }
          return acc;
        }, {}),
        totalQty,
        totalVal,
        suppliers,
        basePrice,
        id: g.codExtern || g.denumire
      };
    });
  }, [rawProducts, selectedSuppliers, priceStrategy, selectedPrices]);

  // Filtrare după căutare
  const filteredProducts = useMemo(() => {
    if (!searchTerm) return groupedProducts;
    const term = searchTerm.toLowerCase();
    return groupedProducts.filter(p => 
      p.denumire.toLowerCase().includes(term) ||
      p.codExtern.toLowerCase().includes(term)
    );
  }, [groupedProducts, searchTerm]);

  // Calcul cu adaos
  const productsWithMarkup = useMemo(() => {
    return filteredProducts.map(p => {
      const itemMarkup = itemMarkups[p.id];
      const totalMarkup = itemMarkup !== undefined ? itemMarkup : globalMarkup;
      const pretVanzare = p.basePrice * (1 + totalMarkup / 100);
      const pretVanzareTVA = pretVanzare * 1.21;
      const hasManualPrice = selectedPrices[p.id] !== undefined;
      return { ...p, totalMarkup, pretVanzare, pretVanzareTVA, hasCustomMarkup: itemMarkup !== undefined, hasManualPrice };
    });
  }, [filteredProducts, globalMarkup, itemMarkups, selectedPrices]);

  const exportToNexus = () => {
    // Exportăm doar produsele selectate, sau toate dacă nu e nimic selectat
    const toExport = selectedForExport.size > 0 
      ? productsWithMarkup.filter(p => selectedForExport.has(p.id))
      : productsWithMarkup;
    
    if (toExport.length === 0) {
      alert('Nu sunt produse selectate pentru export!');
      return;
    }
    
    const nexusData = toExport.map(p => ({
      puv: Math.round(p.pretVanzare * 100) / 100,
      puv_tva: Math.round(p.pretVanzareTVA * 100) / 100,
      denpr: p.denumire,
      um: '',
      cod_ext: p.codExtern,
      nume_clasa: '',
      cod_selectie: '',
      pu_furn: Math.round(p.basePrice * 100) / 100,
    }));
    
    const ws = XLSX.utils.json_to_sheet(nexusData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    
    const date = new Date();
    const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
    XLSX.writeFile(wb, `definit_text_${dateStr}.xlsx`);
  };

  const toggleSupplier = (supplier) => {
    const newSet = new Set(selectedSuppliers);
    if (newSet.has(supplier)) newSet.delete(supplier);
    else newSet.add(supplier);
    setSelectedSuppliers(newSet);
  };

  const selectAllSuppliers = () => setSelectedSuppliers(new Set(suppliers));
  const deselectAllSuppliers = () => setSelectedSuppliers(new Set());
  
  const selectFilteredSuppliers = () => {
    const filtered = suppliers.filter(s => s.toLowerCase().includes(supplierSearch.toLowerCase()));
    setSelectedSuppliers(new Set([...selectedSuppliers, ...filtered]));
  };
  
  const deselectFilteredSuppliers = () => {
    const filtered = suppliers.filter(s => s.toLowerCase().includes(supplierSearch.toLowerCase()));
    const newSet = new Set(selectedSuppliers);
    filtered.forEach(s => newSet.delete(s));
    setSelectedSuppliers(newSet);
  };

  const updateItemMarkup = (id, value) => {
    if (value === '' || value === null) {
      setItemMarkups(prev => { const n = { ...prev }; delete n[id]; return n; });
    } else {
      setItemMarkups(prev => ({ ...prev, [id]: Number(value) || 0 }));
    }
  };

  const toggleExpanded = (id) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const selectPrice = (itemId, price) => {
    setSelectedPrices(prev => ({ ...prev, [itemId]: price }));
  };

  // Funcții pentru selectarea produselor pentru export
  const toggleExportSelection = (id) => {
    setSelectedForExport(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const selectAllForExport = () => {
    const ids = filteredProducts.map(p => p.id);
    setSelectedForExport(new Set(ids));
  };

  const deselectAllForExport = () => {
    setSelectedForExport(new Set());
  };

  const toggleAllForExport = () => {
    if (selectedForExport.size === filteredProducts.length) {
      deselectAllForExport();
    } else {
      selectAllForExport();
    }
  };

  const stats = useMemo(() => {
    const total = productsWithMarkup.length;
    const multiPrice = productsWithMarkup.filter(p => p.uniquePrices.length > 1).length;
    const customMarkup = Object.keys(itemMarkups).length;
    const manualPrices = Object.keys(selectedPrices).length;
    const withDates = productsWithMarkup.filter(p => p.lastEntryDate).length;
    return { total, multiPrice, customMarkup, manualPrices, withDates };
  }, [productsWithMarkup, itemMarkups, selectedPrices]);

  const formatPrice = (p) => p.toFixed(2);

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-full mx-auto">
        <h1 className="text-2xl font-bold text-gray-800 mb-1">Calculator Adaos Produse</h1>
        <p className="text-gray-500 mb-4 text-sm">Grupare pe cod, prețuri multiple în linie, export Nexus</p>

        {/* Upload */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
          <label className="flex items-center justify-center w-full h-20 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-500 hover:bg-blue-50">
            <div className="text-center">
              <p className="text-sm text-gray-500">
                {fileName ? `✓ ${fileName} (${rawProducts.length} intrări)` : 'Click pentru a încărca Excel'}
              </p>
            </div>
            <input type="file" className="hidden" accept=".xlsx,.xls" onChange={(e) => e.target.files[0] && parseExcel(e.target.files[0])} />
          </label>
        </div>

        {loading && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-4 text-center">
            <div className="animate-spin w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
          </div>
        )}

        {rawProducts.length > 0 && !loading && (
          <div className="flex gap-4">
            {/* Sidebar */}
            <div className="w-72 flex-shrink-0 space-y-3">
              {/* Stats */}
              <div className="bg-white rounded-lg shadow-sm p-3 grid grid-cols-2 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold text-gray-800">{stats.total}</p>
                  <p className="text-xs text-gray-500">Produse</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-orange-600">{stats.multiPrice}</p>
                  <p className="text-xs text-gray-500">Multi-preț</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-green-600">{stats.manualPrices}</p>
                  <p className="text-xs text-gray-500">Preț manual</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-blue-600">{stats.withDates}</p>
                  <p className="text-xs text-gray-500">Cu dată</p>
                </div>
              </div>

              {/* Global Markup */}
              <div className="bg-white rounded-lg shadow-sm p-3">
                <label className="text-sm font-medium text-gray-700">Adaos Global</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    value={globalMarkup}
                    onChange={(e) => setGlobalMarkup(Number(e.target.value) || 0)}
                    className="w-full px-2 py-1.5 border rounded text-lg font-medium"
                  />
                  <span className="text-gray-500">%</span>
                </div>
              </div>

              {/* Price Strategy */}
              <div className="bg-white rounded-lg shadow-sm p-3">
                <label className="text-sm font-medium text-gray-700 mb-2 block">Preț de bază (când sunt mai multe)</label>
                <div className="grid grid-cols-2 gap-1">
                  {[
                    { v: 'min', l: '⬇️ Minim' },
                    { v: 'max', l: '⬆️ Maxim' },
                    { v: 'avg', l: '📊 Medie' },
                    { v: 'last', l: '🕐 Ultima' }
                  ].map(opt => (
                    <button
                      key={opt.v}
                      onClick={() => setPriceStrategy(opt.v)}
                      className={`px-2 py-1.5 text-xs rounded ${priceStrategy === opt.v ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Suppliers */}
              <div className="bg-white rounded-lg shadow-sm p-3">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-gray-700">Furnizori ({selectedSuppliers.size}/{suppliers.length})</label>
                  <div className="flex gap-1">
                    <button onClick={selectAllSuppliers} className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                      Toate
                    </button>
                    <button onClick={deselectAllSuppliers} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                      Niciunul
                    </button>
                  </div>
                </div>
                
                <input
                  type="text"
                  placeholder="Caută furnizor..."
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  className="w-full px-2 py-1 text-xs border rounded mb-2"
                />
                
                {/* Furnizori selectați */}
                {(() => {
                  const filtered = suppliers.filter(s => s.toLowerCase().includes(supplierSearch.toLowerCase()));
                  const allSelected = suppliers.filter(s => selectedSuppliers.has(s)); // TOȚI selectații
                  const unselected = filtered.filter(s => !selectedSuppliers.has(s)); // Doar disponibili filtrați
                  
                  return (
                    <>
                      {/* Lista selectați - TOȚI, nu filtrați */}
                      <div className="max-h-40 overflow-y-auto space-y-0.5 mb-2">
                        {allSelected.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-2">Niciun furnizor selectat</p>
                        ) : (
                          allSelected.map(s => {
                            const matchesSearch = s.toLowerCase().includes(supplierSearch.toLowerCase());
                            return (
                              <label key={s} className={`flex items-center gap-2 py-0.5 px-1 rounded cursor-pointer group ${
                                matchesSearch ? 'bg-blue-50' : 'bg-gray-50 opacity-60'
                              }`}>
                                <input type="checkbox" checked={true} onChange={() => toggleSupplier(s)} className="rounded text-blue-500" />
                                <span className={`text-xs truncate flex-1 ${matchesSearch ? 'text-blue-800' : 'text-gray-500'}`} title={s}>{s}</span>
                                <button 
                                  onClick={(e) => { e.preventDefault(); toggleSupplier(s); }}
                                  className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 text-xs"
                                >✕</button>
                              </label>
                            );
                          })
                        )}
                      </div>
                      
                      {/* Separator și toggle pentru neselectați */}
                      {unselected.length > 0 && (
                        <>
                          <button 
                            onClick={() => setShowUnselected(!showUnselected)}
                            className="w-full py-1.5 text-xs text-gray-500 hover:text-gray-700 border-t border-b border-gray-200 flex items-center justify-center gap-1"
                          >
                            <span>{(showUnselected || supplierSearch) ? '▼' : '▶'}</span>
                            <span>Disponibili ({unselected.length})</span>
                          </button>
                          
                          {/* Lista neselectați - vizibilă când e deschisă SAU când căutăm */}
                          {(showUnselected || supplierSearch) && (
                            <div className="max-h-40 overflow-y-auto space-y-0.5 mt-2">
                              {unselected.map(s => (
                                <label key={s} className="flex items-center gap-2 py-0.5 px-1 hover:bg-gray-50 rounded cursor-pointer">
                                  <input type="checkbox" checked={false} onChange={() => toggleSupplier(s)} className="rounded text-blue-500" />
                                  <span className="text-xs text-gray-600 truncate flex-1" title={s}>{s}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 min-w-0">
              <div className="bg-white rounded-lg shadow-sm">
                {/* Header */}
                <div className="p-3 border-b flex gap-3 items-center">
                  <input
                    type="text"
                    placeholder="Caută după denumire sau cod..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-1 px-3 py-1.5 border rounded text-sm"
                  />
                  <button
                    onClick={exportToNexus}
                    disabled={productsWithMarkup.length === 0}
                    className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 disabled:bg-gray-300 flex items-center gap-1"
                  >
                    📥 Export {selectedForExport.size > 0 ? `(${selectedForExport.size})` : `Toate (${productsWithMarkup.length})`}
                  </button>
                </div>
                
                {/* Selection bar */}
                <div className="px-3 py-2 bg-gray-50 border-b flex items-center gap-3 text-sm">
                  <span className="text-gray-600">
                    Selectate: <strong className="text-blue-600">{selectedForExport.size}</strong> din {filteredProducts.length}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={selectAllForExport}
                      className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      Toate
                    </button>
                    <button
                      onClick={deselectAllForExport}
                      className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                    >
                      Niciunul
                    </button>
                  </div>
                  {selectedForExport.size > 0 && (
                    <span className="text-xs text-green-600 ml-auto">
                      ✓ Se vor exporta doar cele selectate
                    </span>
                  )}
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-center w-10">
                          <input 
                            type="checkbox" 
                            checked={selectedForExport.size === filteredProducts.length && filteredProducts.length > 0}
                            onChange={toggleAllForExport}
                            className="rounded text-blue-500"
                            title="Selectează/Deselectează toate"
                          />
                        </th>
                        <th className="px-2 py-2 text-left font-medium text-gray-500 w-28">Cod</th>
                        <th className="px-2 py-2 text-left font-medium text-gray-500">Denumire</th>
                        <th className="px-2 py-2 text-left font-medium text-gray-500 min-w-48">
                          <span className="text-orange-600">Prețuri Intrare</span>
                        </th>
                        <th className="px-2 py-2 text-right font-medium text-gray-500 w-20">Bază</th>
                        <th className="px-2 py-2 text-center font-medium text-gray-500 w-20 bg-green-50">Adaos</th>
                        <th className="px-2 py-2 text-right font-medium text-gray-500 w-20">Vânzare</th>
                        <th className="px-2 py-2 text-right font-medium text-gray-500 w-24">+TVA 21%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {productsWithMarkup.slice(0, 200).map(p => (
                        <tr key={p.id} className={`hover:bg-gray-50 ${selectedForExport.has(p.id) ? 'bg-blue-50/50' : ''} ${p.hasCustomMarkup ? 'bg-purple-50/40' : ''}`}>
                          <td className="px-2 py-1.5 text-center">
                            <input 
                              type="checkbox" 
                              checked={selectedForExport.has(p.id)}
                              onChange={() => toggleExportSelection(p.id)}
                              className="rounded text-blue-500"
                            />
                          </td>
                          <td className="px-2 py-1.5 font-mono text-xs text-gray-600 truncate max-w-28" title={p.codExtern}>
                            {p.codExtern || '—'}
                          </td>
                          <td className="px-2 py-1.5 text-gray-800 truncate max-w-xs" title={p.denumire}>
                            {p.denumire}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex flex-wrap gap-1 items-center">
                              {p.uniquePrices.length > 1 && (
                                <button
                                  onClick={() => toggleExpanded(p.id)}
                                  className="text-xs text-blue-600 hover:text-blue-800 mr-1"
                                  title="Click pentru detalii"
                                >
                                  {expandedItems.has(p.id) ? '▼' : '▶'}
                                </button>
                              )}
                              {!expandedItems.has(p.id) ? (
                                <>
                                  {p.uniquePrices.slice(0, 6).map((price, idx) => {
                                    const isLastEntry = price === p.lastEntryPrice;
                                    const isSelected = price === p.basePrice;
                                    return (
                                      <span
                                        key={idx}
                                        onClick={() => p.uniquePrices.length > 1 && selectPrice(p.id, price)}
                                        className={`px-1.5 py-0.5 rounded text-xs font-mono cursor-pointer transition-all ${
                                          isLastEntry && isSelected
                                            ? 'bg-orange-100 text-orange-800 font-medium ring-1 ring-orange-400'
                                            : isSelected 
                                              ? 'bg-blue-100 text-blue-800 font-medium ring-1 ring-blue-300' 
                                              : isLastEntry
                                                ? 'bg-orange-50 text-orange-700 border border-orange-300'
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                        title={`${formatPrice(price)}${isLastEntry ? ' - Cel mai recent' : ''}`}
                                      >
                                        {formatPrice(price)}
                                      </span>
                                    );
                                  })}
                                  {p.uniquePrices.length > 1 && p.lastEntryDate && (
                                    <span className="text-[10px] text-gray-500 ml-1">
                                      {p.lastEntryDate.toLocaleDateString('ro-RO')}
                                    </span>
                                  )}
                                  {p.uniquePrices.length > 6 && (
                                    <button
                                      onClick={() => toggleExpanded(p.id)}
                                      className="text-xs text-gray-500 hover:text-gray-700"
                                    >
                                      +{p.uniquePrices.length - 6}
                                    </button>
                                  )}
                                </>
                              ) : (
                                <div className="w-full">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-gray-500 border-b">
                                        <th className="text-left py-1 font-medium">Preț</th>
                                        <th className="text-left py-1 font-medium">Furnizor</th>
                                        <th className="text-right py-1 font-medium pr-3">Cant.</th>
                                        <th className="text-center py-1 font-medium pl-3 border-l border-gray-200">Data</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(() => {
                                        const allEntries = Object.values(p.priceDetails)
                                          .flatMap(detail => detail.entries.map(e => ({ ...e, price: detail.price })))
                                          .sort((a, b) => {
                                            if (!a.dataIntrare && !b.dataIntrare) return 0;
                                            if (!a.dataIntrare) return 1;
                                            if (!b.dataIntrare) return -1;
                                            return b.dataIntrare - a.dataIntrare;
                                          });
                                        
                                        const maxDate = p.lastEntry?.dataIntrare;
                                        
                                        return allEntries.map((entry, idx) => {
                                          const isLastEntry = maxDate && entry.dataIntrare && 
                                            entry.dataIntrare.getTime() === maxDate.getTime() &&
                                            entry.price === p.lastEntryPrice;
                                          const isSelected = entry.price === p.basePrice;
                                          
                                          return (
                                            <tr 
                                              key={idx}
                                              onClick={() => selectPrice(p.id, entry.price)}
                                              className={`cursor-pointer ${
                                                isLastEntry 
                                                  ? 'bg-orange-50 border-l-2 border-orange-400' 
                                                  : isSelected 
                                                    ? 'bg-blue-50' 
                                                    : 'hover:bg-gray-50'
                                              }`}
                                            >
                                              <td className={`py-1 px-1 font-mono ${
                                                isLastEntry 
                                                  ? 'font-medium text-orange-700' 
                                                  : isSelected 
                                                    ? 'font-medium text-blue-700' 
                                                    : ''
                                              }`}>
                                                {formatPrice(entry.price)}
                                              </td>
                                              <td className="py-1 truncate max-w-40" title={entry.furnizor}>
                                                {entry.furnizor}
                                              </td>
                                              <td className="py-1 text-right tabular-nums pr-3">
                                                {entry.cantitate.toLocaleString()}
                                              </td>
                                              <td className={`py-1 text-center text-[11px] text-gray-500 pl-3 border-l border-gray-200`}>
                                                {entry.dataIntrare ? entry.dataIntrare.toLocaleDateString('ro-RO') : '—'}
                                              </td>
                                            </tr>
                                          );
                                        });
                                      })()}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className={`px-2 py-1.5 text-right font-medium ${p.hasManualPrice ? 'text-green-700' : 'text-blue-700'}`}>
                            {formatPrice(p.basePrice)}
                            {p.hasManualPrice && <span className="ml-1 text-xs">✓</span>}
                          </td>
                          <td className="px-2 py-1.5 text-center bg-green-50/50">
                            <input
                              type="number"
                              value={p.hasCustomMarkup ? itemMarkups[p.id] : ''}
                              onChange={(e) => updateItemMarkup(p.id, e.target.value)}
                              placeholder={globalMarkup.toString()}
                              className="w-14 px-1 py-0.5 text-xs border rounded text-center bg-white"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right font-medium text-gray-800">
                            {formatPrice(p.pretVanzare)}
                          </td>
                          <td className="px-2 py-1.5 text-right font-bold text-green-700">
                            {formatPrice(p.pretVanzareTVA)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {productsWithMarkup.length > 200 && (
                    <div className="p-3 text-center text-gray-500 bg-gray-50 text-sm">
                      Se afișează primele 200 din {productsWithMarkup.length}. Exportul include toate.
                    </div>
                  )}
                  {productsWithMarkup.length === 0 && (
                    <div className="p-8 text-center text-gray-500">Niciun produs.</div>
                  )}
                </div>
              </div>

              {/* Legend */}
              <div className="mt-3 bg-white rounded-lg shadow-sm p-3 text-xs text-gray-600">
                <span className="font-medium">Legendă:</span>
                <ul className="mt-1 space-y-0.5 ml-2">
                  <li><span className="px-1.5 py-0.5 bg-orange-50 text-orange-700 border border-orange-300 rounded text-[10px]">1.73</span> = cel mai recent preț (după data intrării)</li>
                  <li><span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px]">1.75</span> = preț selectat ca bază</li>
                  <li><span className="text-green-700 font-medium">1.75 ✓</span> = selectat manual</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {rawProducts.length === 0 && !loading && (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-500">
            Încarcă fișierul Excel cu stocurile pentru a începe
          </div>
        )}
      </div>
    </div>
  );
};

export default App;

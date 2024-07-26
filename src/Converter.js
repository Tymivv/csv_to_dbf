import React, { useState, useRef } from 'react';
import { saveAs } from 'file-saver';
import { parse } from 'papaparse';
import style from './app.module.css';

const App = () => {
  const [csvData, setCsvData] = useState(null);
  const [fieldsConfig, setFieldsConfig] = useState([]);
  const fileInputRef = useRef(null);

  const openFileInput = () => {
    fileInputRef.current.click();
  };


  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        const result = parse(text, { header: true });
        setCsvData(result.data);

        const config = Object.keys(result.data[0]).map(key => ({
          name: key,
          type: 'C', // Default
          size: 20, // Default
          decimal: 0 // Default
        }));
        setFieldsConfig(config);
      };
      reader.readAsText(file, 'UTF-8');
    }
  };

  const handleFieldChange = (index, field, value) => {
    const newFieldsConfig = [...fieldsConfig];
    newFieldsConfig[index][field] = value;
    setFieldsConfig(newFieldsConfig);
  };

  const createDbfHeader = (fields, numRecords) => {
    const now = new Date();
    const header = new ArrayBuffer(32 + (fields.length * 32) + 1);
    const view = new DataView(header);

    // dBase III версія
    view.setUint8(0, 0x03);
    view.setUint8(1, now.getFullYear() - 1900);
    view.setUint8(2, now.getMonth() + 1);
    view.setUint8(3, now.getDate());
    view.setUint32(4, numRecords, true);
    view.setUint16(8, 32 + (fields.length * 32) + 1, true);
    view.setUint16(10, fields.reduce((sum, field) => sum + field.size, 1), true);

    fields.forEach((field, index) => {
      const name = field.name.substring(0, 10).padEnd(10, '\0');
      for (let i = 0; i < 10; i++) {
        view.setUint8(32 + (index * 32) + i, name.charCodeAt(i));
      }
      view.setUint8(32 + (index * 32) + 11, field.type.charCodeAt(0));
      view.setUint8(32 + (index * 32) + 16, field.size);
      if (field.type === 'N') {
        view.setUint8(32 + (index * 32) + 17, field.decimal);
      }
    });

    view.setUint8(32 + (fields.length * 32), 0x0D);

    return header;
  };

  const createDbfRecord = (fields, record) => {
    const recordBuffer = new ArrayBuffer(fields.reduce((sum, field) => sum + field.size, 1));
    const view = new DataView(recordBuffer);

    view.setUint8(0, 0x20);

    let offset = 1;
    fields.forEach(field => {
      let value = record[field.name] || '';
      switch (field.type) {
        case 'C':
          value = value.toString().padEnd(field.size, ' ');
          for (let i = 0; i < field.size; i++) {
            let kod =value.charCodeAt(i);
            if (kod > 500) {
                kod -= 592;
            };
            if (kod === "1030") {
                console.log("ok");
                kod = 406;
            };
            view.setUint8(offset + i, kod);
          }
          break;
        case 'N':
          value = parseFloat(value).toFixed(field.decimal).padStart(field.size, ' ');
          for (let i = 0; i < field.size; i++) {
            view.setUint8(offset + i, value.charCodeAt(i));
          }
          break;
          case 'D':   
          const date = new Date(value);
          const formattedDate = date.toISOString().slice(0,10).replace(/-/g, '');
          for (let i = 0; i < 8; i++) {
            view.setUint8(offset + i, formattedDate.charCodeAt(i));
          }
          break;  
          case 'L': 
          value = value.toString().trim().toLowerCase();
          const logicalValue = value === 'true' || value === 't' || value === '1' ? 'T' : 'F';
          view.setUint8(offset, logicalValue.charCodeAt(0));
          break;
        default:
          break;
      }
      offset += field.size;
    });

    return recordBuffer;
  };

  const convertToDBF = () => {
    if (csvData) {
      try {
        fieldsConfig.forEach(field => {
          field.size = parseInt(field.size, 10);
          if (field.type === 'N') {
            field.decimal = parseInt(field.decimal, 10);
            if (isNaN(field.decimal)) {
              field.decimal = 0;
            }
          }
        });

        const header = createDbfHeader(fieldsConfig, csvData.length);
        const records = csvData.map(row => createDbfRecord(fieldsConfig, row));

        let totalLength = header.byteLength;
        records.forEach(record => {
          totalLength += record.byteLength;
        });

        const dbfBuffer = new ArrayBuffer(totalLength + 1);
        const view = new DataView(dbfBuffer);

        let offset = 0;
        new Uint8Array(dbfBuffer).set(new Uint8Array(header), offset);
        offset += header.byteLength;

        records.forEach(record => {
          new Uint8Array(dbfBuffer).set(new Uint8Array(record), offset);
          offset += record.byteLength;
        });

        view.setUint8(totalLength, 0x1A);

        // Windows-1251
        view.setUint8(29, 0xC9);

        const blob = new Blob([dbfBuffer], { type: 'application/octet-stream' });
        saveAs(blob, 'output.dbf');
      } catch (error) {
        console.error('Помилка під час конвертування в DBF:', error);
      }
    }
  };

  return (
    <div className={style.card}>
      <h1>Конвертувати CSV в DBF</h1>
        <input 
          type="file" 
          accept=".csv" 
          onChange={handleFileUpload} 
          required 
          className={style.btn} 
          style={{ display: 'none' }}
          ref={fileInputRef}
        />
        <button 
          type="button"
          className={style.btn} 
          onClick={openFileInput}>
          вибрати CSV
        </button>

      {fieldsConfig.length > 0 && (
        <div id="fieldOptions" className={style.list}>
          <h2 className={style.list_title} >Налаштування полів</h2>

          {fieldsConfig.map((field, index) => (
            <div className={style.item} key={index}>
              
              
                <div className={style.label}>{field.name}:</div>
                <div className={style.select_grup}>
                <select
                  className={style.type} 
                  value={field.type}
                  onChange={(e) => handleFieldChange(index, 'type', e.target.value)}
                >
                  <option value="C">Character</option>
                  <option value="N">Number</option>
                  <option value="L">Logical</option>
                  <option value="D">Date</option>
                </select>
                <input
                  className={style.size}
                  type="number"
                  value={field.size}
                  onChange={(e) => handleFieldChange(index, 'size', e.target.value)}
                  placeholder={
                    field.type === 'D' ? "8" : 
                    field.type === 'L' ? "1" : 
                  "Розмір"
                  }
                />
                {field.type === 'N' && (
                  <input
                    className={style.size}
                    type="number"
                    value={field.decimal}
                    onChange={(e) => handleFieldChange(index, 'decimal', e.target.value)}
                    placeholder="Decimal Places"
                  />
                )}
                </div>
              
            </div>
          ))}
        </div>
      )}
      <button 
        className={style.btn} 
        onClick={convertToDBF} 
        disabled={!csvData}
        >
        Конвертувати у DBF
      </button>
    </div>
  );
  
};

export default App;
import React, { useState, useRef, useEffect } from 'react'; 
import { saveAs } from 'file-saver';
import { parse } from 'papaparse';
import iconv from 'iconv-lite';
import style from './app.module.css';
import { Buffer } from 'buffer';
window.Buffer = window.Buffer || require("buffer").Buffer;

const App = () => {
  const [csvData, setCsvData] = useState(null);
  const [fieldsConfig, setFieldsConfig] = useState([]);
  const [encoding, setEncoding] = useState('win-1251');
  const [autoDetectTypes, setAutoDetectTypes] = useState(false);
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

        const config = Object.keys(result.data[0]).map((key) => {
          const value = result.data[0][key];
          let fieldConfig;
          if (autoDetectTypes) {
            const { type, size, decimal } = determineFieldTypeAndSize(value);
            fieldConfig = {
              name: key,
              type,
              size,
              decimal,
            };
          } else {
            fieldConfig = {
              name: key,
              type: 'C',
              size: 20,
              decimal: 0,
            };
          }
          return fieldConfig;
        });
        setFieldsConfig(config);
      };
      reader.readAsText(file, 'UTF-8');
    }
  };

  useEffect(() => {
    if (csvData && csvData.length > 0) {
      const config = Object.keys(csvData[0]).map((key) => {
        const value = csvData[0][key];
        let fieldConfig;
        if (autoDetectTypes) {
          const { type, size, decimal } = determineFieldTypeAndSize(value);
          fieldConfig = {
            name: key,
            type,
            size,
            decimal,
          };
        } else {
          fieldConfig = {
            name: key,
            type: 'C',
            size: 20,
            decimal: 0,
          };
        }
        return fieldConfig;
      });
      setFieldsConfig(config);
    }
  }, [autoDetectTypes, csvData]);

  const determineFieldTypeAndSize = (value) => {
    if (isDate(value)) {
      return { type: 'D', size: 8, decimal: 0 };
    } else if (isNumeric(value)) {
      const { size, decimal } = getNumberSizeAndDecimal(value);
      return { type: 'N', size, decimal };
    } else {
      const length = value.toString().length;
      return { type: 'C', size: length > 254 ? 254 : length, decimal: 0 };
    }
  };

  const isDate = (value) => {
    const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/;
    return dateRegex.test(value);
  };

  const isNumeric = (value) => {
    const normalizedValue = value.toString().replace(',', '.');
    return !isNaN(parseFloat(normalizedValue)) && isFinite(normalizedValue);
  };

  const getNumberSizeAndDecimal = (value) => {
    const normalizedValue = value.toString().replace(',', '.');
    const numValue = parseFloat(normalizedValue);
    if (isNaN(numValue)) {
      return { size: 10, decimal: 0 };
    }
    const decimalDigits = (normalizedValue.split('.')[1] || '').length;
    const formattedValue = numValue.toFixed(decimalDigits);
    const size = formattedValue.length;
    return { size: size > 20 ? 20 : size, decimal: decimalDigits };
  };

  const handleFieldChange = (index, field, value) => {
    const newFieldsConfig = [...fieldsConfig];
    newFieldsConfig[index][field] = value;

    if (field === 'type') {
      if (value === 'D') {
        newFieldsConfig[index]['size'] = 8;
      } else if (value === 'L') {
        newFieldsConfig[index]['size'] = 1;
      } else if (value === 'C') {
        newFieldsConfig[index]['size'] = 20;
      }
    }

    setFieldsConfig(newFieldsConfig);
  };

  const createDbfHeader = (fields, numRecords) => {
    const now = new Date();
    const header = new ArrayBuffer(32 + fields.length * 32 + 1);
    const view = new DataView(header);

    view.setUint8(0, 0x03);
    view.setUint8(1, now.getFullYear() - 1900);
    view.setUint8(2, now.getMonth() + 1);
    view.setUint8(3, now.getDate());
    view.setUint32(4, numRecords, true);
    view.setUint16(8, 32 + fields.length * 32 + 1, true);
    view.setUint16(
      10,
      fields.reduce((sum, field) => sum + field.size, 1),
      true
    );

    fields.forEach((field, index) => {
      const name = field.name.substring(0, 10).padEnd(10, '\0');
      const encodedName = iconv.encode(name, encoding);
      for (let i = 0; i < 10; i++) {
        view.setUint8(32 + index * 32 + i, encodedName[i] || 0);
      }
      view.setUint8(32 + index * 32 + 11, field.type.charCodeAt(0));
      view.setUint8(32 + index * 32 + 16, field.size);
      if (field.type === 'N') {
        view.setUint8(32 + index * 32 + 17, field.decimal);
      }
    });

    view.setUint8(32 + fields.length * 32, 0x0d);

    return header;
  };

  const createDbfRecord = (fields, record) => {
    const recordBuffer = new ArrayBuffer(
      fields.reduce((sum, field) => sum + field.size, 1)
    );
    const view = new DataView(recordBuffer);

    view.setUint8(0, 0x20);

    let offset = 1;
    fields.forEach((field) => {
      let value = record[field.name] || '';
      switch (field.type) {
        case 'C':
          value = value.toString().padEnd(field.size, ' ');
          const encodedValue = iconv.encode(value, encoding);
          for (let i = 0; i < field.size; i++) {
            view.setUint8(offset + i, encodedValue[i] || 0x20);
          }
          break;
        case 'N':
          value = parseFloat(value.toString().replace(',', '.'))
            .toFixed(field.decimal)
            .padStart(field.size, ' ');
          for (let i = 0; i < field.size; i++) {
            view.setUint8(offset + i, value.charCodeAt(i) || 0x20);
          }
          break;
        case 'D':
          const dateParts = value.split('.');
          if (dateParts.length === 3) {
            const formattedDate = `${dateParts[2]}${dateParts[1]}${dateParts[0]}`;
            for (let i = 0; i < 8; i++) {
              view.setUint8(offset + i, formattedDate.charCodeAt(i) || 0x30);
            }
          } else {
            for (let i = 0; i < 8; i++) {
              view.setUint8(offset + i, 0x30);
            }
          }
          break;
        case 'L':
          value = value.toString().trim().toUpperCase();
          const logicalValue =
            value === 'TRUE' || value === 'T' || value === '1' ? 'T' : 'F';
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
        fieldsConfig.forEach((field) => {
          field.size = parseInt(field.size, 10);
          if (field.type === 'N') {
            field.decimal = parseInt(field.decimal, 10);
            if (isNaN(field.decimal)) {
              field.decimal = 0;
            }
          }
        });

        const header = createDbfHeader(fieldsConfig, csvData.length);
        const records = csvData.map((row) =>
          createDbfRecord(fieldsConfig, row)
        );

        let totalLength = header.byteLength;
        records.forEach((record) => {
          totalLength += record.byteLength;
        });

        const dbfBuffer = new ArrayBuffer(totalLength + 1);
        const view = new DataView(dbfBuffer);

        let offset = 0;
        new Uint8Array(dbfBuffer).set(new Uint8Array(header), offset);
        offset += header.byteLength;

        records.forEach((record) => {
          new Uint8Array(dbfBuffer).set(new Uint8Array(record), offset);
          offset += record.byteLength;
        });

        view.setUint8(totalLength, 0x1a);

        // Встановлення кодування
        if (encoding === 'win-1251') {
          view.setUint8(29, 0xc9);
        } else if (encoding === 'cp866') {
          view.setUint8(29, 0x65);
        }

        const blob = new Blob([dbfBuffer], {
          type: 'application/octet-stream',
        });
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
      <button type="button" className={style.btn} onClick={openFileInput}>
        вибрати CSV
      </button>

      {fieldsConfig.length > 0 && (
        <div id="fieldOptions" className={style.list}>
          <h2 className={style.list_title}>Налаштування полів</h2>
          <div className={style.autoDetect}>
            <label>
              <input
                type="checkbox"
                checked={autoDetectTypes}
                onChange={(e) => setAutoDetectTypes(e.target.checked)}
              />
              Автоматично визначити типи полів
            </label>
          </div>

          {fieldsConfig.map((field, index) => (
            <div className={style.item} key={index}>
              <div className={style.label}>{field.name}:</div>
              <div className={style.select_grup}>
                <select
                  className={style.type}
                  value={field.type}
                  onChange={(e) =>
                    handleFieldChange(index, 'type', e.target.value)
                  }
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
                  onChange={(e) =>
                    handleFieldChange(index, 'size', e.target.value)
                  }
                  placeholder={
                    field.type === 'D'
                      ? '8'
                      : field.type === 'L'
                      ? '1'
                      : 'Розмір'
                  }
                  readOnly={field.type === 'D' || field.type === 'L'}
                />
                {field.type === 'N' && (
                  <input
                    className={style.size}
                    type="number"
                    value={field.decimal}
                    onChange={(e) =>
                      handleFieldChange(index, 'decimal', e.target.value)
                    }
                    placeholder="Кількість знаків після коми"
                  />
                )}
              </div>
            </div>
          ))}

          <div className={style.encoding}>
            <label htmlFor="encoding">Кодування DBF файла:</label>
            <select
              className={style.type}
              id="encoding"
              value={encoding}
              onChange={(e) => setEncoding(e.target.value)}
            >
              <option value="win-1251">Windows-1251</option>
              <option value="cp866">CP866</option>
            </select>
          </div>
        </div>
      )}
      <button className={style.btn} onClick={convertToDBF} disabled={!csvData}>
        Конвертувати у DBF
      </button>
    </div>
  );
};

export default App;

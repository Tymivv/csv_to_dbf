import React from 'react';
import Converter from './Converter';
import style from './app.module.css';


function App() {
    return (
        <div className={style.container}>
          <Converter />
        </div>
    );
}

export default App;

import { useState } from 'react'
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { RandomService } from "./gen/randomnum/v1/random_connect";
import './App.css'

// Create the transport for connecting to our backend
const transport = createConnectTransport({
  baseUrl: "http://dev.local.uniffy.io:8000",
});

// Create the client
const client = createClient(RandomService, transport);

function App() {
  const [randomNumber, setRandomNumber] = useState<number | null>(null);
  const [min, setMin] = useState(1);
  const [max, setMax] = useState(100);
  const [loading, setLoading] = useState(false);

  const getRandomNumber = async () => {
    setLoading(true);
    try {
      const response = await client.getRandomNumber({
        min,
        max,
      });
      setRandomNumber(response.value);
    } catch (error) {
      console.error("Error fetching random number:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1>UWOS - Random Number Service</h1>
      <div className="card">
        <div style={{ marginBottom: '1rem' }}>
          <label>
            Min:{' '}
            <input
              type="number"
              value={min}
              onChange={(e) => setMin(Number(e.target.value))}
              style={{ marginLeft: '0.5rem', width: '100px' }}
            />
          </label>
          <label style={{ marginLeft: '1rem' }}>
            Max:{' '}
            <input
              type="number"
              value={max}
              onChange={(e) => setMax(Number(e.target.value))}
              style={{ marginLeft: '0.5rem', width: '100px' }}
            />
          </label>
        </div>
        <button onClick={getRandomNumber} disabled={loading}>
          {loading ? 'Getting...' : 'Get Random Number'}
        </button>
        {randomNumber !== null && (
          <p style={{ fontSize: '2rem', fontWeight: 'bold', marginTop: '1rem' }}>
            {randomNumber}
          </p>
        )}
      </div>
      <p className="read-the-docs">
        Using ConnectRPC to communicate with the backend
      </p>
    </>
  )
}

export default App

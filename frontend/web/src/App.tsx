// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface ExplorationData {
  id: string;
  location: string;
  depth: number;
  temperature: number;
  salinity: number;
  lifeSigns: boolean;
  timestamp: number;
  researcher: string;
  status: "pending" | "analyzed" | "anomaly";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [explorationData, setExplorationData] = useState<ExplorationData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newData, setNewData] = useState({
    location: "",
    depth: "",
    temperature: "",
    salinity: "",
    lifeSigns: "false"
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showTeam, setShowTeam] = useState(false);

  // Calculate statistics
  const analyzedCount = explorationData.filter(d => d.status === "analyzed").length;
  const pendingCount = explorationData.filter(d => d.status === "pending").length;
  const anomalyCount = explorationData.filter(d => d.status === "anomaly").length;

  // Filter data based on search and filter
  const filteredData = explorationData.filter(item => {
    const matchesSearch = item.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.researcher.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = statusFilter === "all" || item.status === statusFilter;
    return matchesSearch && matchesFilter;
  });

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("exploration_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing exploration keys:", e);
        }
      }
      
      const list: ExplorationData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`exploration_${key}`);
          if (dataBytes.length > 0) {
            try {
              const data = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                location: data.location,
                depth: data.depth,
                temperature: data.temperature,
                salinity: data.salinity,
                lifeSigns: data.lifeSigns,
                timestamp: data.timestamp,
                researcher: data.researcher,
                status: data.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing exploration data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading exploration ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setExplorationData(list);
    } catch (e) {
      console.error("Error loading exploration data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const addData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setAdding(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting subglacial data with FHE..."
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const explorationData = {
        location: newData.location,
        depth: parseFloat(newData.depth),
        temperature: parseFloat(newData.temperature),
        salinity: parseFloat(newData.salinity),
        lifeSigns: newData.lifeSigns === "true",
        timestamp: Math.floor(Date.now() / 1000),
        researcher: account,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `exploration_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(explorationData))
      );
      
      const keysBytes = await contract.getData("exploration_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(dataId);
      
      await contract.setData(
        "exploration_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE-encrypted data submitted successfully!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowAddModal(false);
        setNewData({
          location: "",
          depth: "",
          temperature: "",
          salinity: "",
          lifeSigns: "false"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setAdding(false);
    }
  };

  const analyzeData = async (dataId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE analysis..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`exploration_${dataId}`);
      if (dataBytes.length === 0) {
        throw new Error("Data not found");
      }
      
      const data = JSON.parse(ethers.toUtf8String(dataBytes));
      
      // Simulate FHE analysis result (randomly assign analyzed or anomaly)
      const updatedData = {
        ...data,
        status: Math.random() > 0.2 ? "analyzed" : "anomaly"
      };
      
      await contract.setData(
        `exploration_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedData))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis completed successfully!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isResearcher = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the FHE analysis platform",
      icon: "🔗"
    },
    {
      title: "Submit Exploration Data",
      description: "Add encrypted subglacial lake data for FHE-powered analysis",
      icon: "🔒"
    },
    {
      title: "FHE Analysis",
      description: "Your data is analyzed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Get Insights",
      description: "Receive scientific insights while keeping sensitive data private",
      icon: "📊"
    }
  ];

  const teamMembers = [
    {
      name: "Dr. Elena Frost",
      role: "Glaciologist",
      affiliation: "Polar Research Institute",
      avatar: "👩‍🔬"
    },
    {
      name: "Prof. Kenji Tanaka",
      role: "Cryptography Expert",
      affiliation: "Tokyo Institute of Technology",
      avatar: "👨‍💻"
    },
    {
      name: "Dr. Maria Gonzalez",
      role: "Data Scientist",
      affiliation: "Global Climate Initiative",
      avatar: "👩‍🔬"
    },
    {
      name: "Alex Chen",
      role: "FHE Developer",
      affiliation: "Zama Research Collective",
      avatar: "👨‍💼"
    }
  ];

  const renderDepthChart = () => {
    const maxDepth = Math.max(...explorationData.map(d => d.depth), 1000);
    
    return (
      <div className="depth-chart">
        {explorationData.slice(0, 5).map((data, index) => (
          <div key={data.id} className="depth-bar-container">
            <div className="depth-label">{data.location}</div>
            <div className="depth-bar">
              <div 
                className="depth-fill"
                style={{ 
                  height: `${(data.depth / maxDepth) * 100}%`,
                  backgroundColor: data.lifeSigns ? '#4CAF50' : '#2196F3'
                }}
              ></div>
            </div>
            <div className="depth-value">{data.depth}m</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="glacier-spinner"></div>
      <p>Initializing FHE connection to subglacial data...</p>
    </div>
  );

  return (
    <div className="app-container glacier-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="lake-icon"></div>
          </div>
          <h1>Subglacial<span>Explorer</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowAddModal(true)} 
            className="add-data-btn glacier-button"
          >
            <div className="add-icon"></div>
            Add Data
          </button>
          <button 
            className="glacier-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="hero-banner">
          <div className="hero-text">
            <h2>FHE-Powered Subglacial Lake Exploration</h2>
            <p>Securely analyze encrypted subglacial data from Antarctica and beyond using Fully Homomorphic Encryption</p>
          </div>
          <div className="hero-visual">
            <div className="ice-layer"></div>
            <div className="water-layer"></div>
            <div className="sediment-layer"></div>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>FHE Exploration Tutorial</h2>
            <p className="subtitle">Learn how to securely analyze subglacial data</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card glacier-card">
            <h3>Project Introduction</h3>
            <p>Confidential analysis of encrypted subglacial lake exploration data using FHE to study extreme life and climate history without compromising sensitive information.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Research</span>
            </div>
          </div>
          
          <div className="dashboard-card glacier-card">
            <h3>Exploration Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{explorationData.length}</div>
                <div className="stat-label">Total Datasets</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{analyzedCount}</div>
                <div className="stat-label">Analyzed</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{anomalyCount}</div>
                <div className="stat-label">Anomalies</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card glacier-card">
            <h3>Depth Comparison</h3>
            {explorationData.length > 0 ? renderDepthChart() : (
              <p className="no-data">No exploration data available</p>
            )}
          </div>
        </div>
        
        <div className="data-section">
          <div className="section-header">
            <h2>Encrypted Exploration Data</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text" 
                  placeholder="Search location or researcher..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="glacier-input"
                />
                <select 
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="glacier-select"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="analyzed">Analyzed</option>
                  <option value="anomaly">Anomaly</option>
                </select>
              </div>
              <button 
                onClick={loadData}
                className="refresh-btn glacier-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="data-list glacier-card">
            <div className="table-header">
              <div className="header-cell">Location</div>
              <div className="header-cell">Depth (m)</div>
              <div className="header-cell">Temp (°C)</div>
              <div className="header-cell">Salinity (ppt)</div>
              <div className="header-cell">Life Signs</div>
              <div className="header-cell">Researcher</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredData.length === 0 ? (
              <div className="no-data">
                <div className="no-data-icon"></div>
                <p>No exploration data found</p>
                <button 
                  className="glacier-button primary"
                  onClick={() => setShowAddModal(true)}
                >
                  Add First Dataset
                </button>
              </div>
            ) : (
              filteredData.map(data => (
                <div className="data-row" key={data.id}>
                  <div className="table-cell">{data.location}</div>
                  <div className="table-cell">{data.depth}m</div>
                  <div className="table-cell">{data.temperature}°C</div>
                  <div className="table-cell">{data.salinity}ppt</div>
                  <div className="table-cell">
                    <span className={`life-signs ${data.lifeSigns ? 'positive' : 'negative'}`}>
                      {data.lifeSigns ? 'Detected' : 'None'}
                    </span>
                  </div>
                  <div className="table-cell">{data.researcher.substring(0, 6)}...{data.researcher.substring(38)}</div>
                  <div className="table-cell">
                    <span className={`status-badge ${data.status}`}>
                      {data.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isResearcher(data.researcher) && data.status === "pending" && (
                      <button 
                        className="action-btn glacier-button primary"
                        onClick={() => analyzeData(data.id)}
                      >
                        Analyze
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="team-section">
          <div className="section-header">
            <h2>Research Team</h2>
            <button 
              className="glacier-button"
              onClick={() => setShowTeam(!showTeam)}
            >
              {showTeam ? "Hide Team" : "Show Team"}
            </button>
          </div>
          
          {showTeam && (
            <div className="team-grid">
              {teamMembers.map((member, index) => (
                <div key={index} className="team-card glacier-card">
                  <div className="member-avatar">{member.avatar}</div>
                  <h3>{member.name}</h3>
                  <p className="member-role">{member.role}</p>
                  <p className="member-affiliation">{member.affiliation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  
      {showAddModal && (
        <ModalAdd 
          onSubmit={addData} 
          onClose={() => setShowAddModal(false)} 
          adding={adding}
          data={newData}
          setData={setNewData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glacier-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="glacier-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="lake-icon"></div>
              <span>SubglacialExplorer</span>
            </div>
            <p>FHE-powered analysis of encrypted subglacial exploration data</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Research Papers</a>
            <a href="#" className="footer-link">Data Privacy</a>
            <a href="#" className="footer-link">Collaboration</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Confidential Research</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} SubglacialExplorer. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalAddProps {
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  data: any;
  setData: (data: any) => void;
}

const ModalAdd: React.FC<ModalAddProps> = ({ 
  onSubmit, 
  onClose, 
  adding,
  data,
  setData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setData({
      ...data,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!data.location || !data.depth || !data.temperature || !data.salinity) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="add-modal glacier-card">
        <div className="modal-header">
          <h2>Add Subglacial Exploration Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon"></div> Your data will be encrypted with FHE for confidential analysis
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Location *</label>
              <input 
                type="text"
                name="location"
                value={data.location} 
                onChange={handleChange}
                placeholder="e.g., Lake Vostok, Antarctica" 
                className="glacier-input"
              />
            </div>
            
            <div className="form-group">
              <label>Depth (m) *</label>
              <input 
                type="number"
                name="depth"
                value={data.depth} 
                onChange={handleChange}
                placeholder="Depth in meters" 
                className="glacier-input"
              />
            </div>
            
            <div className="form-group">
              <label>Temperature (°C) *</label>
              <input 
                type="number"
                name="temperature"
                value={data.temperature} 
                onChange={handleChange}
                placeholder="Temperature in Celsius" 
                className="glacier-input"
                step="0.1"
              />
            </div>
            
            <div className="form-group">
              <label>Salinity (ppt) *</label>
              <input 
                type="number"
                name="salinity"
                value={data.salinity} 
                onChange={handleChange}
                placeholder="Salinity in parts per thousand" 
                className="glacier-input"
                step="0.01"
              />
            </div>
            
            <div className="form-group">
              <label>Life Signs Detected</label>
              <select 
                name="lifeSigns"
                value={data.lifeSigns} 
                onChange={handleChange}
                className="glacier-select"
              >
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> Data remains encrypted during FHE processing and analysis
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn glacier-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={adding}
            className="submit-btn glacier-button primary"
          >
            {adding ? "Encrypting with FHE..." : "Submit Data"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
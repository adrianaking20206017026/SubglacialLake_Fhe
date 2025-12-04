// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SubglacialLake_Fhe is SepoliaConfig {
    struct ExplorationData {
        uint256 dataId;
        euint32 encryptedDepth;
        euint32 encryptedTemperature;
        euint32 encryptedSalinity;
        euint32 encryptedMicrobialCount;
        uint256 timestamp;
    }

    struct JointAnalysis {
        euint32 encryptedAvgDepth;
        euint32 encryptedAvgTemp;
        euint32 encryptedAvgSalinity;
        euint32 encryptedTotalMicrobes;
        bool isCompleted;
        bool isRevealed;
    }

    struct DecryptedResult {
        uint32 avgDepth;
        uint32 avgTemp;
        uint32 avgSalinity;
        uint32 totalMicrobes;
        bool isRevealed;
    }

    mapping(address => ExplorationData[]) public researchData;
    mapping(address => JointAnalysis[]) public analyses;
    mapping(address => DecryptedResult[]) public decryptedResults;
    
    uint256 public dataCount;
    uint256 public analysisCount;
    address public admin;
    mapping(address => bool) public researchTeams;
    
    event TeamRegistered(address indexed team);
    event DataSubmitted(address indexed team, uint256 dataId);
    event AnalysisRequested(address indexed requester, uint256 analysisId);
    event AnalysisCompleted(address indexed requester, uint256 analysisId);
    event ResultRevealed(address indexed requester, uint256 resultId);

    constructor() {
        admin = msg.sender;
        researchTeams[admin] = true;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Admin only");
        _;
    }

    modifier onlyTeam() {
        require(researchTeams[msg.sender], "Unauthorized team");
        _;
    }

    function registerTeam(address team) public onlyAdmin {
        researchTeams[team] = true;
        emit TeamRegistered(team);
    }

    function submitExplorationData(
        euint32 depth,
        euint32 temperature,
        euint32 salinity,
        euint32 microbialCount
    ) public onlyTeam {
        dataCount++;
        researchData[msg.sender].push(ExplorationData({
            dataId: dataCount,
            encryptedDepth: depth,
            encryptedTemperature: temperature,
            encryptedSalinity: salinity,
            encryptedMicrobialCount: microbialCount,
            timestamp: block.timestamp
        }));
        emit DataSubmitted(msg.sender, dataCount);
    }

    function requestJointAnalysis() public onlyTeam returns (uint256) {
        analysisCount++;
        uint256 analysisId = analysisCount;
        
        analyses[msg.sender].push(JointAnalysis({
            encryptedAvgDepth: FHE.asEuint32(0),
            encryptedAvgTemp: FHE.asEuint32(0),
            encryptedAvgSalinity: FHE.asEuint32(0),
            encryptedTotalMicrobes: FHE.asEuint32(0),
            isCompleted: false,
            isRevealed: false
        }));
        
        emit AnalysisRequested(msg.sender, analysisId);
        return analysisId;
    }

    function performAnalysis(uint256 analysisId) public onlyTeam {
        require(analysisId <= analysisCount, "Invalid analysis ID");
        require(!analyses[msg.sender][analysisId-1].isCompleted, "Already analyzed");
        
        ExplorationData[] storage data = researchData[msg.sender];
        euint32 totalDepth = FHE.asEuint32(0);
        euint32 totalTemp = FHE.asEuint32(0);
        euint32 totalSalinity = FHE.asEuint32(0);
        euint32 totalMicrobes = FHE.asEuint32(0);
        uint32 dataPoints = 0;
        
        for (uint256 i = 0; i < data.length; i++) {
            totalDepth = FHE.add(totalDepth, data[i].encryptedDepth);
            totalTemp = FHE.add(totalTemp, data[i].encryptedTemperature);
            totalSalinity = FHE.add(totalSalinity, data[i].encryptedSalinity);
            totalMicrobes = FHE.add(totalMicrobes, data[i].encryptedMicrobialCount);
            dataPoints++;
        }
        
        analyses[msg.sender][analysisId-1] = JointAnalysis({
            encryptedAvgDepth: FHE.div(totalDepth, FHE.asEuint32(dataPoints)),
            encryptedAvgTemp: FHE.div(totalTemp, FHE.asEuint32(dataPoints)),
            encryptedAvgSalinity: FHE.div(totalSalinity, FHE.asEuint32(dataPoints)),
            encryptedTotalMicrobes: totalMicrobes,
            isCompleted: true,
            isRevealed: false
        });
        
        emit AnalysisCompleted(msg.sender, analysisId);
    }

    function requestAnalysisDecryption(uint256 analysisId) public onlyTeam {
        require(analysisId <= analysisCount, "Invalid analysis ID");
        require(analyses[msg.sender][analysisId-1].isCompleted, "Analysis not complete");
        require(!analyses[msg.sender][analysisId-1].isRevealed, "Already revealed");
        
        JointAnalysis storage analysis = analyses[msg.sender][analysisId-1];
        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(analysis.encryptedAvgDepth);
        ciphertexts[1] = FHE.toBytes32(analysis.encryptedAvgTemp);
        ciphertexts[2] = FHE.toBytes32(analysis.encryptedAvgSalinity);
        ciphertexts[3] = FHE.toBytes32(analysis.encryptedTotalMicrobes);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptAnalysis.selector);
    }

    function decryptAnalysis(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public onlyTeam {
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        address team = msg.sender;
        uint256 resultId = analyses[team].length - 1;
        
        decryptedResults[team].push(DecryptedResult({
            avgDepth: results[0],
            avgTemp: results[1],
            avgSalinity: results[2],
            totalMicrobes: results[3],
            isRevealed: true
        }));
        
        analyses[team][resultId].isRevealed = true;
        emit ResultRevealed(team, resultId);
    }

    function compareLakeCharacteristics(
        address team1,
        address team2
    ) public view onlyTeam returns (ebool) {
        uint256 count1 = researchData[team1].length;
        uint256 count2 = researchData[team2].length;
        
        return FHE.gt(
            FHE.asEuint32(uint32(count1)),
            FHE.asEuint32(uint32(count2))
        );
    }

    function getDataCount(address team) public view returns (uint256) {
        return researchData[team].length;
    }

    function getAnalysisCount(address team) public view returns (uint256) {
        return analyses[team].length;
    }

    function getDecryptedResult(address team, uint256 resultId) public view returns (
        uint32 avgDepth,
        uint32 avgTemp,
        uint32 avgSalinity,
        uint32 totalMicrobes,
        bool isRevealed
    ) {
        require(resultId <= decryptedResults[team].length, "Invalid result ID");
        DecryptedResult storage result = decryptedResults[team][resultId-1];
        return (
            result.avgDepth,
            result.avgTemp,
            result.avgSalinity,
            result.totalMicrobes,
            result.isRevealed
        );
    }
}
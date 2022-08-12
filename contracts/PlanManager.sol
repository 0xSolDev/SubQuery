// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/Address.sol';

import './interfaces/IServiceAgreementRegistry.sol';
import './interfaces/ISettings.sol';
import './ClosedServiceAgreement.sol';

struct Plan {
    uint256 price;
    uint256 planTemplateId;
    bytes32 deploymentId;
    bool active;
}

struct PlanTemplate {
    uint256 period; // m days
    uint256 dailyReqCap; // n reqs
    uint256 rateLimit; // k reqs per sec
    bytes32 metadata;
    bool active;
}

contract PlanManager is Initializable, OwnableUpgradeable {
    ISettings public settings;

    uint256 public planTemplateIds;
    mapping(uint256 => PlanTemplate) public planTemplates; // planTemplateId => planTemplate

    mapping(address => uint256) public planCount; // indexer => index
    mapping(address => mapping(uint256 => Plan)) public plans; // indexer => index => plan
    mapping(address => mapping(bytes32 => uint256[])) public planIds; // indexer => deploymentId => planIds
    uint16 public indexerPlanLimit;

    event PlanTemplateCreated(uint256 indexed planTemplateId);
    event PlanTemplateMetadataChanged(uint256 indexed planTemplateId, bytes32 metadata);
    event PlanTemplateStatusChanged(uint256 indexed planTemplateId, bool active);

    event PlanCreated(
        address indexed creator,
        bytes32 indexed deploymentId,
        uint256 planTemplateId,
        uint256 planId,
        uint256 price
    );

    event PlanRemoved(address indexed source, uint256 id, bytes32 deploymentId);

    function initialize(ISettings _settings) external initializer {
        __Ownable_init();

        settings = _settings;
        indexerPlanLimit = 5;
    }

    function setIndexerPlanLimit(uint16 _indexerPlanLimit) external onlyOwner {
        indexerPlanLimit = _indexerPlanLimit;
    }

    // admin governance
    function createPlanTemplate(
        uint256 _period,
        uint256 _dailyReqCap,
        uint256 _rateLimit,
        bytes32 _metadata
    ) external onlyOwner {
        require(_period > 0, 'Period need to be positive');
        require(_dailyReqCap > 0, 'DailyReqCap need to be positive');
        require(_rateLimit > 0, 'RateLimit need to be positive');

        planTemplates[planTemplateIds] = PlanTemplate(_period, _dailyReqCap, _rateLimit, _metadata, true);

        emit PlanTemplateCreated(planTemplateIds);

        planTemplateIds++;
    }

    function updatePlanTemplateMetadata(uint256 _planTemplateId, bytes32 _metadata) external onlyOwner {
        require(planTemplates[_planTemplateId].period > 0, 'Plan template not existing');

        planTemplates[_planTemplateId].metadata = _metadata;

        emit PlanTemplateMetadataChanged(_planTemplateId, _metadata);
    }

    function updatePlanTemplateStatus(uint256 _planTemplateId, bool _active) external onlyOwner {
        require(planTemplates[_planTemplateId].period > 0, 'Plan template not existing');

        planTemplates[_planTemplateId].active = _active;

        emit PlanTemplateStatusChanged(_planTemplateId, _active);
    }

    function createPlan(
        uint256 _price,
        uint256 _planTemplateId,
        bytes32 _deploymentId
    ) external {
        require(_price > 0, 'Price need to be positive');
        require(planTemplates[_planTemplateId].active == true, 'Inactive plan template');
        require(planIds[msg.sender][_deploymentId].length < indexerPlanLimit, 'Indexer plan limitation reached');

        uint256 _planCount = planCount[msg.sender];
        plans[msg.sender][_planCount] = Plan(_price, _planTemplateId, _deploymentId, true);
        planIds[msg.sender][_deploymentId].push(_planCount);
        planCount[msg.sender]++;

        emit PlanCreated(msg.sender, _deploymentId, _planTemplateId, _planCount, _price);
    }

    function removePlan(uint256 _planId) external {
        require(plans[msg.sender][_planId].active == true, 'Inactive plan can not be removed');

        plans[msg.sender][_planId].active = false;
        bytes32 deploymentId = plans[msg.sender][_planId].deploymentId;

        // remove _planId from planIds
        uint256[] memory ids = planIds[msg.sender][deploymentId];
        delete planIds[msg.sender][deploymentId];
        for (uint256 i; i < ids.length; i++) {
            if (_planId != ids[i]) {
                planIds[msg.sender][deploymentId].push(_planId);
            }
        }

        emit PlanRemoved(msg.sender, _planId, deploymentId);
    }

    // customer function
    function acceptPlan(
        address _indexer,
        bytes32 _deploymentId,
        uint256 _planId
    ) external {
        Plan memory plan = plans[_indexer][_planId];
        require(plan.active == true, 'Inactive plan');
        require(_deploymentId != bytes32(0), 'DeploymentId can not be empty');
        require(
            plan.deploymentId == ((planIds[_indexer][_deploymentId].length == 0) ? bytes32(0) : _deploymentId),
            'Plan not match with the deployment'
        );

        // create closed service agreement contract
        ClosedServiceAgreement serviceAgreement = new ClosedServiceAgreement(
            address(settings),
            msg.sender,
            _indexer,
            _deploymentId,
            plan.price,
            planTemplates[plan.planTemplateId].period,
            plan.planTemplateId,
            false
        );

        // deposit SQToken into serviceAgreementRegistry contract
        IERC20(ISettings(settings).getSQToken()).transferFrom(
            msg.sender,
            settings.getServiceAgreementRegistry(),
            plan.price
        );

        IServiceAgreementRegistry(settings.getServiceAgreementRegistry()).establishServiceAgreement(
            address(serviceAgreement)
        );
    }

    // view function
    function templates() external view returns (PlanTemplate[] memory) {
        PlanTemplate[] memory _templates = new PlanTemplate[](planTemplateIds);
        for (uint256 i = 0; i < planTemplateIds; i++) {
            _templates[i] = planTemplates[i];
        }

        return _templates;
    }

    function indexerPlans(address indexer) external view returns (Plan[] memory) {
        Plan[] memory _plans = new Plan[](planCount[indexer]);
        for (uint256 i = 0; i < planCount[indexer]; i++) {
            _plans[i] = plans[indexer][i];
        }

        return _plans;
    }
}

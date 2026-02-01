import { useTranslation } from 'react-i18next';
import './i18n';
import React, { useState, useEffect, Suspense } from 'react';
import { AmazonConnectApp, AppContactScope } from "@amazon-connect/app";
import { AgentClient, AgentStateChangedEventData, ContactClient } from "@amazon-connect/contact";
import { VoiceClient } from "@amazon-connect/voice";
import { applyConnectTheme } from "@amazon-connect/theme";
import { loadConfig } from './config';

// Cloudscapeコンポーネントを遅延ロード
const Container = React.lazy(() => import("@cloudscape-design/components/container"));
const Header = React.lazy(() => import("@cloudscape-design/components/header"));
const Tabs = React.lazy(() => import("@cloudscape-design/components/tabs"));
const SpaceBetween = React.lazy(() => import("@cloudscape-design/components/space-between"));
const FormField = React.lazy(() => import("@cloudscape-design/components/form-field"));
const Input = React.lazy(() => import("@cloudscape-design/components/input"));
const Select = React.lazy(() => import("@cloudscape-design/components/select"));
const Button = React.lazy(() => import("@cloudscape-design/components/button"));
const Box = React.lazy(() => import("@cloudscape-design/components/box"));
const StatusIndicator = React.lazy(() => import("@cloudscape-design/components/status-indicator"));
const Alert = React.lazy(() => import("@cloudscape-design/components/alert"));
const ColumnLayout = React.lazy(() => import("@cloudscape-design/components/column-layout"));

import '@cloudscape-design/global-styles/index.css';
import './App.css';

// グローバル変数としてVoiceClientを保持
let voiceClientInstance = null;

// 追加: initializeAppState用のグローバル変数
let initializeAppState;

// グローバルで初期化
const connectApp = AmazonConnectApp.init({
  onCreate: async (event) => {
    const { appInstanceId } = event.context;
    console.log('App initialized: ', appInstanceId);
    voiceClientInstance = new VoiceClient();
    applyConnectTheme();
    
    // 追加: アプリ作成時に初期化処理を行う
    if (initializeAppState) {
      await initializeAppState();
    }
  },
  onDestroy: (event) => {
    console.log('App being destroyed');
  },
});

// クライアントのインスタンス化
const agentClient = new AgentClient();
const contactClient = new ContactClient();

function App() {
  const { t } = useTranslation();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Initializing...');
  const [agentInfo, setAgentInfo] = useState(null);
  const [contactInfo, setContactInfo] = useState(null);
  const [activeTab, setActiveTab] = useState('outbound');
  const [outboundNumber, setOutboundNumber] = useState('');
  const [outboundStatus, setOutboundStatus] = useState('');
  const [selectedQueueARN, setSelectedQueueARN] = useState('');
  const [availableQueues, setAvailableQueues] = useState([]);
  const [countryCode, setCountryCode] = useState('');
  const [phoneNumberWithoutCode, setPhoneNumberWithoutCode] = useState('');
  const [contactAttributes, setContactAttributes] = useState({});
  const [hasActiveContact, setHasActiveContact] = useState(false);

  const getQueueDisplayName = (queueName) => {
    if (!config?.queueDisplayNames || typeof queueName !== 'string') {
      return null;
    }
    return config.queueDisplayNames[queueName] || queueName;
  };

  const formatPhoneNumber = (countryCode, phoneNumber) => {
    if (countryCode === '+81' && phoneNumber.startsWith('0')) {
      return `${countryCode}${phoneNumber.substring(1)}`;
    }
    return `${countryCode}${phoneNumber}`;
  };

  // 修正: fetchContactData関数（contactIdをパラメータで受け取る）
  async function fetchContactData(contactId) {
    try {
      if (!contactId) {
        console.log('[fetchContactData] No contactId provided');
        setContactInfo({
          id: '-',
          channelType: 'No active contact',
          phoneNumber: '-',
          queueName: '-',
          timestamp: new Date().toLocaleString()
        });
        return;
      }

      console.log(`[fetchContactData] Fetching data for contact: ${contactId}`);

      // チャネルタイプを取得
      let type = 'unknown';
      try {
        const channelType = await contactClient.getChannelType(contactId);
        console.log(`[fetchContactData] Raw channel type:`, channelType);
        
        // チャネルタイプが文字列かオブジェクトかを判定
        if (typeof channelType === 'string') {
          type = channelType;
        } else if (channelType && typeof channelType === 'object') {
          // オブジェクトの場合、type, name, valueなどのプロパティを確認
          type = channelType.type || channelType.name || channelType.value || 'unknown';
        }
        console.log(`[fetchContactData] Parsed contact type: ${type}`);
      } catch (typeError) {
        console.error('[fetchContactData] Error fetching channel type:', typeError);
      }

      let phoneNumber = '-';
      let queueName = '-';

      // キュー情報を取得（VoiceとChat両方で試行）
      try {
        const queueDetails = await contactClient.getQueue(contactId);
        console.log('[fetchContactData] Queue details:', queueDetails);
        queueName = queueDetails?.name || 'N/A';
      } catch (queueError) {
        console.error('[fetchContactData] Error fetching queue:', queueError);
      }

      // 電話番号を取得（複数の方法を試行）
      // 方法1: VoiceClientから取得（AppContactScope.CurrentContactIdを使用）
      if (type === 'voice' && voiceClientInstance) {
        try {
          console.log('[fetchContactData] Attempting to get phone number from VoiceClient with AppContactScope...');
          const voicePhoneNumber = await voiceClientInstance.getPhoneNumber(AppContactScope.CurrentContactId);
          console.log('[fetchContactData] Voice phone number from VoiceClient:', voicePhoneNumber);
          if (voicePhoneNumber) {
            phoneNumber = voicePhoneNumber;
          }
        } catch (voiceError) {
          console.error('[fetchContactData] Error fetching voice phone number:', voiceError);
        }
      } else {
        console.log(`[fetchContactData] Skipping VoiceClient (type: ${type}, voiceClientInstance: ${!!voiceClientInstance})`);
      }

      // 方法2: CustomerEndpoint属性から取得
      if (phoneNumber === 'N/A') {
        try {
          console.log('[fetchContactData] Attempting to get CustomerEndpoint attribute...');
          const phoneAttr = await contactClient.getAttribute(
            contactId,
            'CustomerEndpoint'
          );
          console.log('[fetchContactData] CustomerEndpoint attribute:', phoneAttr);
          if (phoneAttr?.value) {
            phoneNumber = phoneAttr.value;
          }
        } catch (attrError) {
          console.error('[fetchContactData] Error fetching CustomerEndpoint attribute:', attrError);
        }
      }

      console.log(`[fetchContactData] Final phone number: ${phoneNumber}`);

      setContactInfo({
        id: contactId,
        channelType: type || 'No active contact',
        phoneNumber: phoneNumber,
        queueName: queueName,
        timestamp: new Date().toLocaleString()
      });
    } catch (error) {
      console.error('[fetchContactData] Error:', error);
      setContactInfo({
        id: '-',
        channelType: 'No active contact',
        phoneNumber: '-',
        queueName: '-',
        timestamp: new Date().toLocaleString()
      });
    }
  }

  // 修正: fetchContactAttributes関数（contactIdをパラメータで受け取る）
  const fetchContactAttributes = async (contactId) => {
    try {
      if (!contactId) {
        console.log('[fetchContactAttributes] No contactId provided');
        setContactAttributes({});
        setHasActiveContact(false);
        return;
      }

      console.log(`[fetchContactAttributes] Fetching attributes for contact: ${contactId}`);

      // チャネルタイプを取得
      const type = await contactClient.getChannelType(contactId);
      console.log(`[fetchContactAttributes] Contact type: ${type}`);

      // 属性キーのリストを作成
      const attributeKeys = Array.from(
        { length: config.maxContactAttributes }, 
        (_, i) => `Key${i + 1}`
      );
      console.log('[fetchContactAttributes] Requesting attributes:', attributeKeys);

      // ContactClientのgetAttributesメソッドを使用（contactIdを直接指定）
      const attributes = await contactClient.getAttributes(
        contactId,
        attributeKeys
      );
      console.log(`[${type}] Fetched contact attributes:`, attributes);
      
      setContactAttributes(attributes || {});
      setHasActiveContact(true);
    } catch (error) {
      console.error('[fetchContactAttributes] Error:', error);
      console.error('[fetchContactAttributes] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      setContactAttributes({});
      setHasActiveContact(false);
    }
  };

  async function fetchAgentData() {
    try {
      const arn = await agentClient.getARN();
      const currentState = await agentClient.getState();
      const agentName = await agentClient.getName();
      const routingProfile = await agentClient.getRoutingProfile();

      console.log('Agent data:', {
        currentState,
        agentName,
        routingProfile
      });

      setStatus('Connected');
      setAgentInfo(prevInfo => ({
        agentARN: arn,
        agentId: arn ? arn.split('/').pop() : '-',
        agentName: agentName || '-',
        currentState: currentState.state?.name || currentState.state?.type || 'Unknown',
        routingProfile: routingProfile,
        timestamp: new Date().toLocaleString()
      }));
    } catch (error) {
      console.error('Error fetching agent data:', error);
      setStatus('Error processing agent info');
    }
  }

  // 追加: initializeAppState関数の定義
  initializeAppState = async () => {
    try {
      // 初期化時はAppContactScopeを使用してcontactIdを取得
      const initialContactId = await contactClient.getInitialContactId(AppContactScope.CurrentContactId);
      const status = await agentClient.getState();

      console.log('[initializeAppState] Initial contact ID:', initialContactId);

      if (initialContactId) {
        const type = await contactClient.getChannelType(initialContactId);
        console.log('[initializeAppState] Current contact type:', type);

        // Voice と Chat 両方に対応
        await fetchContactData(initialContactId);
        await fetchContactAttributes(initialContactId);
        setHasActiveContact(true);

        // ステータスに応じてメッセージを変更するが、コンタクト情報は維持
        if (status.name === 'AfterCallWork') {
          setOutboundStatus('アフターコールワークを終了してください');
        } else {
          // 一律「通話中」に設定
          setOutboundStatus('通話中');
        }
      } else {
        console.log('[initializeAppState] No active contact');
        setContactInfo({
          id: '-',
          channelType: 'No active contact',
          phoneNumber: '-',
          queueName: '-',
          timestamp: new Date().toLocaleString()
        });
        setContactAttributes({});
        setHasActiveContact(false);
        setOutboundStatus('');
      }
    } catch (error) {
      console.error('[initializeAppState] Error:', error);
      console.error('[initializeAppState] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      setContactInfo({
        id: '-',
        channelType: 'No active contact',
        phoneNumber: '-',
        queueName: '-',
        timestamp: new Date().toLocaleString()
      });
      setContactAttributes({});
      setHasActiveContact(false);
      setOutboundStatus('');
    }
  };

  const handleOutboundCall = async () => {
    if (!voiceClientInstance) {
      setOutboundStatus('システムの初期化中です。しばらくお待ちください。');
      return;
    }

    if (!phoneNumberWithoutCode) {
      setOutboundStatus('電話番号を入力してください');
      return;
    }

    if (!selectedQueueARN) {
      setOutboundStatus('発信キューを選択してください');
      return;
    }

    const formattedNumber = formatPhoneNumber(countryCode, phoneNumberWithoutCode);
    const phoneNumberPattern = /^\+[1-9]\d{1,14}$/;

    if (!phoneNumberPattern.test(formattedNumber)) {
      setOutboundStatus('電話番号が正しい形式ではありません');
      return;
    }

    try {
      const permission = await voiceClientInstance.getOutboundCallPermission();
      if (permission === false) {
        setOutboundStatus('発信できません: 発信権限がありません');
        return;
      }

      if (status.name === 'Busy') {
        setOutboundStatus('通話中');
      } else {
        setOutboundStatus('');
      }

      console.log('Making outbound call to:', formattedNumber);
      const outboundCallResult = await voiceClientInstance.createOutboundCall(formattedNumber, {
        queueARN: selectedQueueARN
      });

      setPhoneNumberWithoutCode('');
    } catch (error) {
      console.error('Outbound call error:', error);
      if (error.message.includes('requestNotAuthorized')) {
        setOutboundStatus('発信権限エラー: アプリケーション統合で Contact.Details.Edit 権限を有効にしてください。');
      } else {
        setOutboundStatus(`発信エラー: ${error.message}`);
      }
    }
  };

  const stateChangeHandler = async (data) => {
    try {
      const currentState = await agentClient.getState();
      setAgentInfo(prevInfo => ({
        ...prevInfo,
        currentState: currentState.state?.name || 'Unknown',
        timestamp: new Date().toLocaleString()
      }));
    } catch (error) {
      console.error('State change error:', error);
    }
  };

  useEffect(() => {
    loadConfig().then(configData => {
      console.log('Config loaded:', configData);
      setConfig(configData);
      setCountryCode(configData.countryCode[0]?.value || '+81');
      setLoading(false);
    }).catch(error => {
      console.error('Failed to load config:', error);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!config) return;

    const initialize = async () => {
      await initializeAppState();
      await fetchAgentData();
    };

    initialize();

    const agentSubscription = agentClient.onStateChanged(stateChangeHandler);

    const contactHandler = async () => {
      await fetchContactData();
      await fetchAgentData();
    };

    const onConnectedHandler = async (data) => {
      console.log('[onConnected] Contact connected event fired, data:', data);
      const contactId = data?.contactId;
      
      if (!contactId) {
        console.error('[onConnected] No contactId in event data');
        return;
      }
      
      console.log('[onConnected] Contact ID:', contactId);
      
      // ステータスを一律「通話中」に設定
      setOutboundStatus('通話中');
      
      // コンタクト情報を取得
      await fetchContactData(contactId);
      await fetchAgentData();
      
      // コンタクト属性を取得
      await fetchContactAttributes(contactId);
    };

    const onDestroyedHandler = async (data) => {
      console.log('[onDestroyed] Contact destroyed event fired, data:', data);
      const contactId = data?.contactId;
      
      if (contactId) {
        await fetchContactData(contactId);
        await fetchAgentData();
      }
      
      setContactAttributes({});
      setHasActiveContact(false);
      setOutboundStatus('');
    };

    const onStartingAcwHandler = async (data) => {
      console.log('[onStartingAcw] Starting ACW event fired, data:', data);
      const contactId = data?.contactId;
      
      if (contactId) {
        await fetchContactData(contactId);
        await fetchAgentData();
      }
      
      setOutboundStatus('アフターコールワークを終了してください');
    };

    contactClient.onConnected(onConnectedHandler);
    contactClient.onStartingAcw(onStartingAcwHandler);
    contactClient.onDestroyed(onDestroyedHandler);

    return () => {
      if (agentSubscription?.unsubscribe) {
        agentSubscription.unsubscribe();
      }
    };
  }, [config]);

  useEffect(() => {
    if (agentInfo?.routingProfile?.queues) {
      setAvailableQueues(agentInfo.routingProfile.queues.filter(queue => queue.name));
      if (agentInfo.routingProfile.queues.length > 0) {
        setSelectedQueueARN(agentInfo.routingProfile.queues[0].queueARN);
      }
    }
  }, [agentInfo]);

  if (loading || !config) {
    return <div>{t('common.config.loadingMessage')}</div>;
  }

  const renderHeader = () => (
    <Suspense fallback={<div>{t('common.header.loadingMessage')}</div>}>
      <Header
        variant="h1"
        description={`Status: ${status} | Version: ${config?.version || 'N/A'}`}
      >
      </Header>
    </Suspense>
  );

  const renderContactInfo = () => (
    <Suspense fallback={<div>{t('contact.info.loadingMessage')}</div>}>
      <ColumnLayout columns={2} variant="text-grid">
        <div>
          <Box variant="awsui-key-label">
            <Box fontWeight="bold">コンタクトID</Box>
          </Box>
          <Box variant="p">{contactInfo?.id || '-'}</Box>
        </div>
        <div>
          <Box variant="awsui-key-label">
            <Box fontWeight="bold">キュー名</Box>
          </Box>
          <Box variant="p">{contactInfo?.queueName || '-'}</Box>
        </div>
        <div>
          <Box variant="awsui-key-label">
            <Box fontWeight="bold">電話番号</Box>
          </Box>
          <Box variant="p">{contactInfo?.phoneNumber || '-'}</Box>
        </div>
        <div>
          <Box variant="awsui-key-label">
            <Box fontWeight="bold">更新日時</Box>
          </Box>
          <Box variant="p">{contactInfo?.timestamp || '-'}</Box>
        </div>
      </ColumnLayout>
    </Suspense>
  );

  const renderOutboundTab = () => {
    const countryOptions = config ? Object.entries(config.countryCode).map(([label, value]) => ({
      label,
      value
    })) : [];

    return (
      <Suspense fallback={<div>{t('tab.outbound.loadingMessage')}</div>}>
        <Container>
          <SpaceBetween size="l">
            <FormField label="発信キュー(発信者ID番号)">
              <Select
                selectedOption={
                  availableQueues.find(q => q.queueARN === selectedQueueARN)
                    ? {
                        label: (() => {
                          const queue = availableQueues.find(q => q.queueARN === selectedQueueARN);
                          const displayNumber = getQueueDisplayName(queue?.name);
                          return displayNumber 
                            ? `${queue.name} (${displayNumber})`
                            : queue.name;
                        })(),
                        value: selectedQueueARN
                      }
                    : null
                }
                onChange={({ detail }) => setSelectedQueueARN(detail.selectedOption.value)}
                options={availableQueues.map(queue => ({
                  label: getQueueDisplayName(queue.name)
                    ? `${queue.name} (${getQueueDisplayName(queue.name)})`
                    : queue.name,
                  value: queue.queueARN
                }))}
              />
            </FormField>

            <FormField label="発信先電話番号">
              <div className="phone-number-container">
                <Select
                  selectedOption={countryOptions.find(option => option.value === countryCode)}
                  onChange={({ detail }) => setCountryCode(detail.selectedOption.value)}
                  options={countryOptions}
                  className="country-code-select"
                />
                <Input
                  value={phoneNumberWithoutCode}
                  onChange={({ detail }) => setPhoneNumberWithoutCode(detail.value)}
                  placeholder="電話番号を入力してください"
                  className="phone-number-input"
                />
                <Button
                  variant="primary"
                  onClick={handleOutboundCall}
                  disabled={!phoneNumberWithoutCode || !selectedQueueARN || !voiceClientInstance}
                >
                  発信
                </Button>
              </div>
            </FormField>

            {outboundStatus && (
              <Alert type={outboundStatus.includes('エラー') ? 'error' : 'success'}>
                {outboundStatus}
              </Alert>
            )}
          </SpaceBetween>
        </Container>
      </Suspense>
    );
  };

  const renderContactAttribute = (key) => {
    const allowedKeys = Object.keys(config?.contactAttributes || {});
    if (!allowedKeys.includes(key)) {
      return null;
    }

    return (
      <div key={key}>
        <Box variant="awsui-key-label">
          <Box fontWeight="bold">{config?.contactAttributes[key]}</Box>
        </Box>
        <Box variant="p">{contactAttributes[key]?.value || '-'}</Box>
      </div>
    );
  };

  const renderAttributesTab = () => (
    <Suspense fallback={<div>{t('tab.attribute.loadingMessage')}</div>}>
      <Container>
        {hasActiveContact && config ? (
          <SpaceBetween size="l">
            <ColumnLayout columns={2} variant="text-grid">
              {Object.keys(config?.contactAttributes || {}).map(renderContactAttribute)}
            </ColumnLayout>
          </SpaceBetween>
        ) : (
          <Alert type="info">
            通話が確立されると、コンタクト属性が表示されます。
          </Alert>
        )}
      </Container>
    </Suspense>
  );

  return (
    <Suspense fallback={<div>{t('common.app.loadingMessage')}</div>}>
      <div className="app">
        <SpaceBetween size="l">
          {renderHeader()}
          {renderContactInfo()}
          <Tabs
            tabs={[
              {
                label: "外線発信",
                id: "outbound",
                content: renderOutboundTab()
              },
              {
                label: "自分の通話履歴",
                id: "history",
                content: (
                  <Suspense fallback={<div>{t('tab.history.loadingMessage')}</div>}>
                    <Container>
                      <Button
                        onClick={() => window.open(config?.contactSearchUrl || '#', '_blank')}
                      >
                        通話履歴を開く
                      </Button>
                    </Container>
                  </Suspense>
                )
              },
              {
                label: "コンタクト属性",
                id: "attributes",
                content: renderAttributesTab()
              }
            ]}
            activeTabId={activeTab}
            onChange={({ detail }) => setActiveTab(detail.activeTabId)}
          />
        </SpaceBetween>
      </div>
    </Suspense>
  );
}

export default App;

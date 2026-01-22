
import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Lucide from 'lucide-react';
import { CuisineType, DietaryRestriction, TimeConstraint, DishSuggestion, FullRecipe, AppState } from './types';
import { 
  getSuggestions, 
  getFullRecipe, 
  generateDishImage, 
  connectCoach, 
  decodeAudioData, 
  decode, 
  encode 
} from './services/geminiService';

const CUISINES: CuisineType[] = ['Mediterranean', 'East Asian', 'Latin American', 'Italian', 'Indian', 'Quick Comfort'];
const RESTRICTIONS: DietaryRestriction[] = ['None', 'Vegan', 'Vegetarian', 'Gluten-Free', 'Keto'];
const TIMES: TimeConstraint[] = ['15 mins', '30 mins', '45 mins', '60 mins'];

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.ONBOARDING);
  const [cuisine, setCuisine] = useState<CuisineType>('Mediterranean');
  const [restriction, setRestriction] = useState<DietaryRestriction>('None');
  const [time, setTime] = useState<TimeConstraint>('30 mins');
  
  const [suggestions, setSuggestions] = useState<DishSuggestion[]>([]);
  const [selectedDish, setSelectedDish] = useState<DishSuggestion | null>(null);
  const [recipe, setRecipe] = useState<FullRecipe | null>(null);
  const [recipeImage, setRecipeImage] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  
  // Voice Coach State
  const [coachActive, setCoachActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcription, setTranscription] = useState('');
  
  const audioContextIn = useRef<AudioContext | null>(null);
  const audioContextOut = useRef<AudioContext | null>(null);
  const sessionPromise = useRef<Promise<any> | null>(null);
  const nextStartTime = useRef(0);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Ambient Music Logic
  const ambientAudio = useRef<HTMLAudioElement | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);

  useEffect(() => {
    ambientAudio.current = new Audio('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'); // Fallback placeholder loop
    ambientAudio.current.loop = true;
    ambientAudio.current.volume = 0.15;
    
    return () => {
      ambientAudio.current?.pause();
      stopCoach();
    };
  }, []);

  const toggleMusic = () => {
    if (musicPlaying) {
      ambientAudio.current?.pause();
    } else {
      ambientAudio.current?.play();
    }
    setMusicPlaying(!musicPlaying);
  };

  const initAudio = () => {
    if (!audioContextOut.current) {
      audioContextOut.current = new AudioContext({ sampleRate: 24000 });
      audioContextIn.current = new AudioContext({ sampleRate: 16000 });
    }
  };

  const startCoach = async () => {
    initAudio();
    setCoachActive(true);
    
    sessionPromise.current = connectCoach({
      onAudio: async (base64) => {
        if (!audioContextOut.current) return;
        nextStartTime.current = Math.max(nextStartTime.current, audioContextOut.current.currentTime);
        const buffer = await decodeAudioData(decode(base64), audioContextOut.current, 24000, 1);
        const source = audioContextOut.current.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContextOut.current.destination);
        source.start(nextStartTime.current);
        nextStartTime.current += buffer.duration;
        activeSources.current.add(source);
        source.onended = () => activeSources.current.delete(source);
      },
      onInterrupted: () => {
        activeSources.current.forEach(s => s.stop());
        activeSources.current.clear();
        nextStartTime.current = 0;
      },
      onTranscription: (text, isInput) => {
        if (isInput) setIsListening(false);
        setTranscription(text);
      }
    });

    // Microphone setup
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audioContextIn.current!.createMediaStreamSource(stream);
      const processor = audioContextIn.current!.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        const b64 = encode(new Uint8Array(pcm16.buffer));
        sessionPromise.current?.then(session => {
          session.sendRealtimeInput({ media: { data: b64, mimeType: 'audio/pcm;rate=16000' } });
        });
      };
      
      source.connect(processor);
      processor.connect(audioContextIn.current!.destination);
      setIsListening(true);
    } catch (err) {
      console.error('Mic error:', err);
    }
  };

  const stopCoach = () => {
    setCoachActive(false);
    sessionPromise.current?.then(s => s.close());
    sessionPromise.current = null;
    activeSources.current.forEach(s => s.stop());
    activeSources.current.clear();
  };

  const handleFetchSuggestions = async () => {
    setLoading(true);
    setLoadingMsg('Marco is checking the pantry...');
    try {
      const results = await getSuggestions(cuisine, restriction, time);
      setSuggestions(results);
      setAppState(AppState.SUGGESTING);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDish = async (dish: DishSuggestion) => {
    setSelectedDish(dish);
    setLoading(true);
    setLoadingMsg(`Mastering the plan for ${dish.name}...`);
    try {
      const full = await getFullRecipe(dish);
      setRecipe(full);
      setAppState(AppState.PLANNING);
      const img = await generateDishImage(full.imagePrompt);
      setRecipeImage(img);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setAppState(AppState.ONBOARDING);
    setSuggestions([]);
    setSelectedDish(null);
    setRecipe(null);
    setRecipeImage(null);
    stopCoach();
  };

  return (
    <div className="min-h-screen pb-20">
      {/* Dynamic Background */}
      <div className="fixed inset-0 -z-10 bg-warm opacity-40">
        <div className="absolute top-0 right-0 w-1/2 h-full bg-[#16653408] rounded-l-full blur-3xl animate-subtle" />
      </div>

      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3 cursor-pointer group" onClick={reset}>
          <div className="bg-appetizing-gradient p-2.5 rounded-2xl text-white shadow-lg transition-transform group-hover:scale-110">
            <Lucide.Utensils size={24} />
          </div>
          <span className="text-2xl font-extrabold tracking-tight text-gray-900">Chef's <span className="text-appetizing">Compass</span></span>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={toggleMusic}
            className={`p-3 rounded-full transition-all ${musicPlaying ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
            title="Toggle Kitchen Ambience"
          >
            {musicPlaying ? <Lucide.Music4 size={20} /> : <Lucide.Music size={20} />}
          </button>
          
          <button 
            onClick={coachActive ? stopCoach : startCoach}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-bold transition-all ${
              coachActive ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-appetizing-gradient text-white shadow-md hover:shadow-lg'
            }`}
          >
            {coachActive ? (
              <>
                <div className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                Coach Marco Live
              </>
            ) : (
              <>
                <Lucide.Mic size={18} />
                Talk to Chef
              </>
            )}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto mt-8 px-6">
        {loading ? (
          <div className="h-[60vh] flex flex-col items-center justify-center space-y-8">
            <div className="relative">
              <div className="w-32 h-32 border-4 border-gray-100 border-t-green-600 rounded-full animate-spin" />
              <Lucide.ChefHat size={48} className="absolute inset-0 m-auto text-green-600 animate-bounce" />
            </div>
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-800 mb-2">Prepping the menu...</h2>
              <p className="text-gray-500 italic">"{loadingMsg}"</p>
            </div>
          </div>
        ) : (
          <>
            {/* Coach Transcription Overlay */}
            {coachActive && (
              <div className="fixed bottom-6 right-6 w-80 bg-white border border-green-100 shadow-2xl rounded-3xl p-5 z-40 transform transition-all hover:scale-105">
                <div className="flex items-center gap-3 mb-3 pb-2 border-b border-gray-50">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold">M</div>
                  <div>
                    <h4 className="font-bold text-sm">Chef Marco</h4>
                    <span className="text-[10px] uppercase text-green-500 font-bold tracking-widest">Always Listening</span>
                  </div>
                </div>
                <p className="text-gray-600 text-sm leading-relaxed min-h-[40px]">
                  {transcription || "Say 'Hey Marco' to start brainstorming your dinner..."}
                </p>
                {isListening && (
                  <div className="mt-3 flex gap-1 justify-center">
                    {[1,2,3,4].map(i => <div key={i} className="w-1 h-3 bg-green-500 rounded-full animate-pulse" />)}
                  </div>
                )}
              </div>
            )}

            {appState === AppState.ONBOARDING && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="text-center mb-16 max-w-2xl mx-auto">
                  <h1 className="text-6xl font-black text-gray-900 mb-6 tracking-tight leading-tight">
                    Tonight's <span className="text-appetizing">Culinary</span> Mission.
                  </h1>
                  <p className="text-xl text-gray-500 font-medium leading-relaxed">
                    Tell Chef Marco your mood, or select your preferences below to build the perfect meal plan in seconds.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
                  {[
                    { title: 'Region', icon: <Lucide.MapPin size={24} />, state: cuisine, setter: setCuisine, items: CUISINES },
                    { title: 'Diet', icon: <Lucide.Leaf size={24} />, state: restriction, setter: setRestriction, items: RESTRICTIONS },
                    { title: 'Time', icon: <Lucide.Timer size={24} />, state: time, setter: setTime, items: TIMES }
                  ].map((card, idx) => (
                    <div key={idx} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-3 mb-6 text-appetizing">
                        {card.icon}
                        <h3 className="font-bold text-xl">{card.title}</h3>
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        {card.items.map(item => (
                          <button
                            key={item}
                            onClick={() => card.setter(item as any)}
                            className={`px-4 py-2 rounded-2xl text-sm font-semibold transition-all ${
                              card.state === item 
                                ? 'bg-appetizing-gradient text-white shadow-md scale-105' 
                                : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                            }`}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-center">
                  <button
                    onClick={handleFetchSuggestions}
                    className="group bg-appetizing-gradient text-white px-12 py-5 rounded-3xl text-2xl font-black shadow-2xl hover:shadow-green-200 transform transition-all hover:-translate-y-1 flex items-center gap-3"
                  >
                    Craft My Menu
                    <Lucide.ChefHat size={28} className="group-hover:rotate-12 transition-transform" />
                  </button>
                </div>
              </div>
            )}

            {appState === AppState.SUGGESTING && (
              <div className="animate-in fade-in duration-500">
                <button onClick={reset} className="flex items-center gap-2 text-gray-500 font-bold mb-10 hover:text-green-700 transition-colors">
                  <Lucide.ArrowLeft size={20} /> Restart Mission
                </button>
                <div className="flex justify-between items-end mb-10">
                  <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">Today's <span className="text-appetizing">Specials</span></h2>
                  <p className="text-gray-400 font-medium">Curated for your {cuisine} appetite.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                  {suggestions.map((dish) => (
                    <div key={dish.id} className="group bg-white rounded-[3rem] overflow-hidden border border-gray-100 shadow-md hover:shadow-2xl transition-all flex flex-col h-full hover:-translate-y-2">
                      <div className="p-10 flex-1">
                        <div className="flex justify-between items-center mb-6">
                          <span className="bg-green-100 text-green-700 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest">
                            {dish.difficulty}
                          </span>
                          <div className="flex items-center gap-1.5 text-gray-400 font-bold text-sm">
                            <Lucide.Timer size={18} /> {dish.estimatedTime}
                          </div>
                        </div>
                        <h3 className="text-3xl font-black mb-6 text-gray-900 group-hover:text-green-700 transition-colors">{dish.name}</h3>
                        <p className="text-gray-500 leading-relaxed font-medium line-clamp-4">{dish.description}</p>
                      </div>
                      <button
                        onClick={() => handleSelectDish(dish)}
                        className="w-full bg-appetizing-gradient hover:bg-green-800 text-white py-6 text-xl font-black transition-colors"
                      >
                        Cook This
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {appState === AppState.PLANNING && (
              <div className="max-w-5xl mx-auto animate-in zoom-in-95 duration-500">
                <div className="bg-white rounded-[4rem] shadow-2xl overflow-hidden border border-gray-100">
                  <div className="relative h-[500px]">
                    {recipeImage ? (
                      <img src={recipeImage} alt={recipe?.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gray-50 flex items-center justify-center">
                        <Lucide.Image size={64} className="text-gray-200 animate-pulse" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent flex items-end">
                      <div className="p-12 text-white">
                        <h2 className="text-6xl font-black mb-4 tracking-tighter">{recipe?.name}</h2>
                        <p className="text-white/80 text-xl max-w-3xl font-medium leading-relaxed italic">
                          "{recipe?.description}"
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-12 grid grid-cols-1 md:grid-cols-12 gap-16">
                    <div className="md:col-span-4">
                      <div className="bg-warm p-8 rounded-[3rem] border border-orange-50">
                        <h3 className="text-2xl font-black mb-8 flex items-center gap-3 text-appetizing">
                          <Lucide.ShoppingBag /> Ingredients
                        </h3>
                        <ul className="space-y-5">
                          {recipe?.ingredients.map((ing, i) => (
                            <li key={i} className="flex items-start gap-3 text-gray-700 font-semibold border-b border-gray-100 pb-3">
                              <div className="w-2.5 h-2.5 rounded-full bg-orange-400 mt-1.5 flex-shrink-0" /> {ing}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="md:col-span-8">
                      <h3 className="text-3xl font-black mb-8 flex items-center gap-3 text-gray-900">
                        <Lucide.Sparkles className="text-green-600" /> Chef's Strategy
                      </h3>
                      <div className="grid grid-cols-1 gap-6 mb-12">
                        {recipe?.coachTips.map((tip, i) => (
                          <div key={i} className="bg-white border-2 border-green-50 p-8 rounded-[2.5rem] flex gap-6 hover:border-green-100 transition-all shadow-sm">
                            <div className="bg-green-600 text-white w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 font-black text-lg">
                              {i+1}
                            </div>
                            <p className="text-gray-700 text-lg font-medium leading-relaxed italic">"{tip}"</p>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={() => setAppState(AppState.COOKING)}
                        className="w-full bg-appetizing-gradient text-white py-6 rounded-[2.5rem] text-3xl font-black shadow-2xl hover:shadow-green-100 transform transition-all hover:scale-[1.02] flex items-center justify-center gap-5"
                      >
                        Let's Cook Together <Lucide.Play size={32} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {appState === AppState.COOKING && (
              <div className="max-w-4xl mx-auto animate-in slide-in-from-right-8 duration-500">
                <div className="flex justify-between items-center mb-12">
                  <div>
                    <h2 className="text-4xl font-black text-gray-900 mb-2">Live Session</h2>
                    <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Dish: {recipe?.name}</p>
                  </div>
                  <button onClick={reset} className="p-3 text-gray-300 hover:text-red-500 transition-colors">
                    <Lucide.XCircle size={32} />
                  </button>
                </div>

                <div className="space-y-8">
                  {recipe?.steps.map((step, i) => (
                    <div key={i} className="group bg-white p-10 rounded-[3rem] shadow-sm border border-gray-100 flex gap-8 hover:shadow-xl transition-all cursor-pointer">
                      <div className="w-16 h-16 rounded-[1.5rem] bg-gray-50 flex items-center justify-center flex-shrink-0 font-black text-2xl text-gray-300 group-hover:bg-appetizing-gradient group-hover:text-white transition-all">
                        {i + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-2xl text-gray-700 font-medium leading-relaxed mb-6">{step}</p>
                        <div className="flex items-center gap-6">
                          <button 
                            className="flex items-center gap-2 text-sm font-black text-green-700 hover:bg-green-50 px-4 py-2 rounded-2xl transition-all"
                            onClick={() => coachActive && sessionPromise.current?.then(s => s.sendRealtimeInput({ text: `Tell me about step ${i+1}: ${step}` }))}
                          >
                            <Lucide.HelpCircle size={18} /> Ask Chef
                          </button>
                          <div className="w-px h-4 bg-gray-100" />
                          <button className="text-gray-300 text-xs font-black uppercase tracking-widest hover:text-green-600 transition-colors">
                            Mark Complete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-20 bg-appetizing-gradient rounded-[4rem] p-16 text-center text-white shadow-2xl overflow-hidden relative">
                  <div className="absolute top-0 right-0 p-8 opacity-10">
                    <Lucide.ChefHat size={200} />
                  </div>
                  <Lucide.CheckCircle size={80} className="mx-auto mb-8 text-green-400" />
                  <h3 className="text-5xl font-black mb-4 tracking-tighter">Chef d'Oeuvre!</h3>
                  <p className="text-green-100 text-xl mb-12 max-w-md mx-auto font-medium opacity-80">
                    Your meal is ready to be plated. Marco is proud of your progress today.
                  </p>
                  <button
                    onClick={reset}
                    className="bg-white text-green-900 px-12 py-5 rounded-3xl font-black text-xl hover:bg-green-50 transition-all shadow-xl active:scale-95"
                  >
                    Close Kitchen
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="mt-24 py-12 px-6 text-center border-t border-gray-100">
        <div className="flex justify-center items-center gap-8 mb-6 text-gray-300">
          <Lucide.Instagram className="hover:text-pink-500 cursor-pointer" />
          <Lucide.Twitter className="hover:text-blue-400 cursor-pointer" />
          <Lucide.ChefHat className="text-appetizing" />
        </div>
        <p className="text-gray-400 text-sm font-bold uppercase tracking-widest">&copy; 2024 Chef's Compass • Pure AI Culinary Arts</p>
      </footer>
    </div>
  );
};

export default App;

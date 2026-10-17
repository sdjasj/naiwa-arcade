export default function Home() {
  return <main style={{minHeight:'100vh',background:'#f9faf5',color:'#293d32',display:'grid',placeItems:'center',padding:24}}>
    <section style={{maxWidth:560,padding:36,border:'1px solid #dce3d5',borderRadius:24,background:'#fffdf6'}}>
      <p style={{color:'#75904e',fontSize:13}}>NAIWA ARCADE · GLOBAL SCORES</p>
      <h1 style={{fontSize:30,margin:'16px 0'}}>把快乐，笑上排行榜。</h1>
      <p style={{lineHeight:1.9,color:'#6d7e5e'}}>十一款奶蛙小游戏，79 个全球积分榜。经典与无限模式、难度、训练项目和操控方式分别排名，每位玩家保留最好的一次。</p>
      <p style={{lineHeight:1.9,color:'#6d7e5e'}}>在游戏里填写昵称即可参与。昵称与上榜成绩公开展示，玩家身份保存在当前浏览器；清理网站数据后将无法找回原身份。</p>
      <a href="https://sdjasj.github.io/naiwa-arcade/" style={{display:'inline-block',marginTop:20,padding:'12px 20px',borderRadius:30,background:'#527445',color:'white'}}>回到奶蛙乐园，开始挑战 →</a>
    </section>
  </main>;
}

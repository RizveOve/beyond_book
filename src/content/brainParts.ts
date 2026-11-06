import type { PartInfo } from './parts';

/** Educational content for the brain model, keyed by mesh-name prefix. */
export const BRAIN_PARTS: Record<string, PartInfo> = {
  FrontalLobe: {
    key: 'FrontalLobe',
    name: 'Frontal lobe',
    color: '#d6d6d6',
    summary:
      'Plans, decides and controls behaviour. Its back strip (the motor cortex) sends the signals that move your muscles.',
    fact: 'It is the last part of the brain to fully mature, at around age 25.',
  },
  ParietalLobe: {
    key: 'ParietalLobe',
    name: 'Parietal lobe',
    color: '#c2c2c2',
    summary:
      'Processes touch, temperature and pain, and works out where your body is in space.',
    fact: 'Its front strip holds a “map” of the body; lips and fingertips get the most space.',
  },
  TemporalLobe: {
    key: 'TemporalLobe',
    name: 'Temporal lobe',
    color: '#adadad',
    summary: 'Handles hearing, understanding language and forming new memories.',
    fact: 'The hippocampus, essential for new memories, is tucked inside it.',
  },
  OccipitalLobe: {
    key: 'OccipitalLobe',
    name: 'Occipital lobe',
    color: '#999999',
    summary: 'The visual centre. It turns signals from the eyes into the images you see.',
    fact: 'It sits at the back of the head, as far from the eyes as the brain goes.',
  },
  Cerebellum: {
    key: 'Cerebellum',
    name: 'Cerebellum',
    color: '#858585',
    summary: 'Coordinates movement, balance and posture, and helps learn motor skills.',
    fact: 'It holds over half of the brain’s neurons in about a tenth of its volume.',
  },
  Brainstem: {
    key: 'Brainstem',
    name: 'Brainstem',
    color: '#707070',
    summary:
      'Connects the brain to the spinal cord and runs automatic functions such as breathing, heart rate and swallowing.',
    fact: 'The bulge at its front, the pons, means “bridge” in Latin.',
  },
  SpinalCord: {
    key: 'SpinalCord',
    name: 'Spinal cord',
    color: '#7a7a7a',
    summary: 'The main cable carrying messages between the brain and the rest of the body.',
    fact: 'Some reflexes, like pulling your hand from a hot stove, are handled here before the brain even knows.',
  },
  CorpusCallosum: {
    key: 'CorpusCallosum',
    name: 'Corpus callosum',
    color: '#f0f0f0',
    summary: 'A thick band of about 200 million nerve fibres linking the left and right hemispheres.',
    fact: 'Use “Explode” to split the hemispheres and see it in the middle.',
  },
  Thalamus: {
    key: 'Thalamus',
    name: 'Thalamus',
    color: '#8f8f8f',
    summary:
      'The brain’s relay station. Almost every sense (except smell) passes through it on the way to the cortex.',
    fact: 'There are two thalami, one deep in each hemisphere.',
  },
  PituitaryGland: {
    key: 'PituitaryGland',
    name: 'Pituitary gland',
    color: '#616161',
    summary:
      'A pea-sized gland that releases hormones controlling growth, metabolism and other glands.',
    fact: 'It is often called the “master gland” of the body.',
  },
  OlfactoryBulbs: {
    key: 'OlfactoryBulbs',
    name: 'Olfactory bulbs',
    color: '#b8b8b8',
    summary: 'Receive signals from the nose; the first stop for your sense of smell.',
    fact: 'Smell is the only sense that skips the thalamus on its way into the brain.',
  },
};
